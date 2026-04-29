import fs from "node:fs/promises";
import path from "node:path";
import type { Response, Router } from "express";
import { Router as createRouter } from "express";
import type { Prisma } from "@prisma/client";
import {
  AnalyzeTurnBodySchema,
  BootstrapSessionBodySchema,
  type ProviderConfig,
  ProviderConfigSchema,
  LockAndAdvanceBodySchema,
  ResuggestNextBodySchema,
  UpdateSessionContextBodySchema,
  UpdateTurnRecommendedPromptBodySchema,
} from "@prompttrace/shared";
import { prisma } from "../db.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  asTestTurnImageUpdate,
  type TurnImageLookup,
  withImageAsset,
} from "../types/testTurnRow.js";
import {
  adjustConfidence,
  runHeuristics,
} from "../services/heuristics.js";
import {
  analyzePastedResponseRouted,
  generateAdversarialPromptRouted,
  resuggestRecommendedNextPromptRouted,
} from "../services/providerRouter.js";
import { resolveAttackVector } from "../services/attackVectors.js";
import {
  contentTypeForAssetFilename,
  getRepoRoot,
  loadImageDataUrlFromAsset,
  removeTurnImageAsset,
  resolveAssetAbsolutePath,
  saveTurnImageFromDataUrl,
} from "../services/sessionAssets.js";
import {
  buildSessionMarkdownReport,
  type SessionWithTurns,
} from "../services/sessionReportMarkdown.js";

const router: Router = createRouter();

const GENERATED_REPORTS_DIR =
  "docs/generated_reports";

async function resolveImageDataUrlForAnalysis(
  repoRoot: string,
  turn: TurnImageLookup,
  bodyImage: string | null | undefined,
): Promise<string | null> {
  if (bodyImage !== undefined) {
    if (bodyImage === null) return null;
    return bodyImage.trim();
  }
  const url =
    turn.pastedModelImageDataUrl?.trim();
  if (url) return url;
  const asset =
    turn.pastedModelImageAssetPath?.trim();
  if (!asset) return null;
  return (
    (await loadImageDataUrlFromAsset(
      repoRoot,
      asset,
    )) ?? null
  );
}

/** Mutations are blocked until the client reopens the session (status ACTIVE). */
const SESSION_CONCLUDED_MSG =
  "This session is concluded. Reopen it on the workbench to continue.";

function err(
  res: Response,
  status: number,
  message: string,
  details?: unknown,
) {
  return res
    .status(status)
    .json({ error: message, details });
}

function providerFromMeta(
  meta: unknown,
): ProviderConfig | undefined {
  if (!meta || typeof meta !== "object") {
    return undefined;
  }
  const raw = (
    meta as { provider?: unknown }
  ).provider;
  const parsed = ProviderConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

function aggressiveFromMeta(meta: unknown): boolean {
  if (!meta || typeof meta !== "object")
    return false;
  const v = (
    meta as {
      aggressiveFraming?: unknown;
    }
  ).aggressiveFraming;
  return Boolean(v);
}

type TurnAgg = {
  turnNumber: number;
  evaluationVerdict: string | null;
  evaluationScore: number | null;
};

function verdictRank(v: string): number {
  if (v === "FAILED") return 2;
  if (v === "BORDERLINE") return 1;
  return 0;
}

function summarizeSessionForList(
  turns: TurnAgg[],
  sessionStatus: string,
) {
  const analyzed = turns.filter(
    (t) => t.evaluationVerdict != null,
  );
  const scores = analyzed
    .map((t) => t.evaluationScore)
    .filter(
      (n): n is number => typeof n === "number",
    );
  let aggregateVerdict:
    | "SAFE"
    | "BORDERLINE"
    | "FAILED"
    | null = null;
  for (const t of analyzed) {
    const v = t.evaluationVerdict as
      | "SAFE"
      | "BORDERLINE"
      | "FAILED";
    if (
      aggregateVerdict == null ||
      verdictRank(v) >
        verdictRank(aggregateVerdict)
    ) {
      aggregateVerdict = v;
    }
  }
  let sessionScore: number | null = null;
  if (scores.length > 0) {
    const avg = Math.round(
      scores.reduce((a, b) => a + b, 0) /
        scores.length,
    );
    sessionScore = Math.min(
      100,
      Math.max(1, avg),
    );
  }
  const hadModelFailure = analyzed.some(
    (t) => t.evaluationVerdict === "FAILED",
  );
  const isConcluded =
    sessionStatus === "ARCHIVED";
  const redTeamSuccess =
    isConcluded && hadModelFailure
      ? true
      : isConcluded
        ? false
        : null;
  const latestTurnNumber =
    turns.length === 0
      ? null
      : Math.max(
          ...turns.map((t) => t.turnNumber),
        );

  return {
    aggregateVerdict,
    sessionScore,
    analyzedTurnCount: analyzed.length,
    totalTurnCount: turns.length,
    isConcluded,
    redTeamSuccess,
    hadModelFailure,
    latestTurnNumber,
  };
}

function formatSessionTitle(
  category: string,
  custom?: string | null,
) {
  if (custom?.trim()) return custom.trim();
  const d = new Date();
  const date = d.toISOString().slice(0, 10);
  return `Untitled - ${category} - ${date}`;
}

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const sessions =
      await prisma.testSession.findMany({
        orderBy: { updatedAt: "desc" },
        include: {
          turns: {
            orderBy: { turnNumber: "asc" },
            select: {
              turnNumber: true,
              evaluationVerdict: true,
              evaluationScore: true,
            },
          },
        },
      });
    const list = sessions.map((s) => {
      const { turns, ...rest } = s;
      const summary = summarizeSessionForList(
        turns,
        s.status,
      );
      return {
        ...rest,
        ...summary,
      };
    });
    res.json(list);
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const reqId = Math.random()
      .toString(36)
      .slice(2, 8);
    const started = Date.now();
    console.log(`[sessions:${reqId}] create start`);
    const parsed =
      BootstrapSessionBodySchema.safeParse(
        req.body,
      );
    if (!parsed.success)
      return err(
        res,
        400,
        "Invalid body",
        parsed.error.flatten(),
      );

    const b = parsed.data;
    console.log(
      `[sessions:${reqId}] payload strategy="${b.strategy}" category="${b.category}" provider="${b.provider?.providerType ?? "default"}"`,
    );
    const title = formatSessionTitle(
      b.category,
      b.title,
    );
    const aggressive = b.aggressive === true;
    const attackVector = resolveAttackVector(
      b.strategy,
    );

    let gen: Awaited<
      ReturnType<
        typeof generateAdversarialPromptRouted
      >
    >;
    try {
      console.log(
        `[sessions:${reqId}] generating first prompt`,
      );
      gen = await generateAdversarialPromptRouted(
        {
          modelType: b.modelType,
          modelNameOrNotes: b.modelNameOrNotes,
          category: b.category,
          strategy: b.strategy,
          objective: b.objective,
          aggressive,
        },
        b.provider,
      );
      console.log(
        `[sessions:${reqId}] prompt generated chars=${gen.generatedPrompt.length}`,
      );
    } catch (e) {
      console.error(e);
      console.error(
        `[sessions:${reqId}] generate failed elapsed_ms=${Date.now() - started}`,
      );
      return err(
        res,
        502,
        "Prompt generation failed",
        e instanceof Error ? e.message : e,
      );
    }

    const session =
      await prisma.testSession.create({
        data: {
          title,
          modelType: b.modelType,
          modelNameOrNotes:
            b.modelNameOrNotes ?? null,
          category: b.category,
          strategy: b.strategy,
          objective: b.objective ?? null,
          turns: {
            create: {
              turnNumber: 1,
              generatedPrompt:
                gen.generatedPrompt,
              generatedMeta: {
                objective: gen.objective,
                pressurePoint: gen.pressurePoint,
                notes: gen.notes ?? null,
                aggressiveFraming: aggressive,
                attackVector: attackVector.vector,
                attackVectorLabel:
                  attackVector.label,
                ...(b.provider
                  ? { provider: b.provider }
                  : {}),
              },
            },
          },
        },
        include: {
          turns: {
            orderBy: { turnNumber: "asc" },
          },
        },
      });

    console.log(
      `[sessions:${reqId}] create ok sessionId=${session.id} elapsed_ms=${Date.now() - started}`,
    );
    return res.status(201).json(session);
  }),
);

router.get(
  "/:id/turns/:turnId/image",
  asyncHandler(async (req, res) => {
    const session =
      await prisma.testSession.findUnique({
        where: { id: req.params.id },
      });
    if (!session)
      return err(res, 404, "Session not found");
    const turnRaw =
      await prisma.testTurn.findFirst({
        where: {
          id: req.params.turnId,
          sessionId: session.id,
        },
      });
    if (!turnRaw)
      return err(res, 404, "Turn not found");
    const turn = withImageAsset(turnRaw);
    if (!turn.pastedModelImageAssetPath?.trim())
      return err(res, 404, "Image not found");
    const abs = resolveAssetAbsolutePath(
      getRepoRoot(),
      turn.pastedModelImageAssetPath.trim(),
    );
    if (!abs)
      return err(res, 404, "Image not found");
    const buf = await fs.readFile(abs);
    res.setHeader(
      "Content-Type",
      contentTypeForAssetFilename(abs),
    );
    res.setHeader(
      "Cache-Control",
      "private, max-age=3600",
    );
    res.send(buf);
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const session =
      await prisma.testSession.findUnique({
        where: { id: req.params.id },
        include: {
          turns: {
            orderBy: { turnNumber: "asc" },
          },
        },
      });
    if (!session)
      return err(res, 404, "Session not found");
    res.json(session);
  }),
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed =
      UpdateSessionContextBodySchema.safeParse(
        req.body,
      );
    if (!parsed.success)
      return err(
        res,
        400,
        "Invalid body",
        parsed.error.flatten(),
      );

    const exists =
      await prisma.testSession.findUnique({
        where: { id: req.params.id },
      });
    if (!exists)
      return err(res, 404, "Session not found");

    const b = parsed.data;
    if (
      exists.status === "ARCHIVED" &&
      b.status !== "ACTIVE"
    )
      return err(res, 400, SESSION_CONCLUDED_MSG);

    const session =
      await prisma.testSession.update({
        where: { id: req.params.id },
        data: {
          category: b.category,
          strategy: b.strategy,
          objective: b.objective,
          ...(b.status !== undefined
            ? { status: b.status }
            : {}),
        },
        include: {
          turns: {
            orderBy: { turnNumber: "asc" },
          },
        },
      });

    const refreshed =
      await prisma.testSession.findUnique({
        where: { id: req.params.id },
        include: {
          turns: {
            orderBy: { turnNumber: "asc" },
          },
        },
      });
    res.json(refreshed);
  }),
);

router.patch(
  "/:id/turns/:turnId",
  asyncHandler(async (req, res) => {
    const parsed =
      UpdateTurnRecommendedPromptBodySchema.safeParse(
        req.body,
      );
    if (!parsed.success)
      return err(
        res,
        400,
        "Invalid body",
        parsed.error.flatten(),
      );

    const session =
      await prisma.testSession.findUnique({
        where: { id: req.params.id },
      });
    if (!session)
      return err(res, 404, "Session not found");
    if (session.status === "ARCHIVED")
      return err(res, 400, SESSION_CONCLUDED_MSG);

    const turn = await prisma.testTurn.findFirst({
      where: {
        id: req.params.turnId,
        sessionId: session.id,
      },
    });
    if (!turn)
      return err(res, 404, "Turn not found");
    if (turn.nextPromptLockedAt != null)
      return err(
        res,
        400,
        "This turn is locked - open the latest turn to continue the session",
      );
    if (turn.evaluationVerdict == null)
      return err(
        res,
        400,
        "Analyze this turn before editing the recommended follow-up prompt",
      );

    const text =
      parsed.data.recommendedNextPrompt.trim();
    const prevRaw = turn.heuristicFlags;
    const prevFlags =
      prevRaw != null &&
      typeof prevRaw === "object" &&
      !Array.isArray(prevRaw)
        ? {
            ...(prevRaw as Record<
              string,
              unknown
            >),
          }
        : {};

    await prisma.testTurn.update({
      where: { id: turn.id },
      data: {
        recommendedNextPrompt: text,
        heuristicFlags: {
          ...prevFlags,
          analystEditedRecommendedNextPrompt: true,
        } as Prisma.InputJsonValue,
      },
    });

    await prisma.testSession.update({
      where: { id: session.id },
      data: { updatedAt: new Date() },
    });

    const full =
      await prisma.testSession.findUnique({
        where: { id: session.id },
        include: {
          turns: {
            orderBy: { turnNumber: "asc" },
          },
        },
      });
    res.json(full);
  }),
);

router.post(
  "/:id/turns/:turnId/resuggest-next",
  asyncHandler(async (req, res) => {
    const parsed =
      ResuggestNextBodySchema.safeParse(req.body);
    if (!parsed.success)
      return err(
        res,
        400,
        "Invalid body",
        parsed.error.flatten(),
      );

    const session =
      await prisma.testSession.findUnique({
        where: { id: req.params.id },
      });
    if (!session)
      return err(res, 404, "Session not found");
    if (session.status === "ARCHIVED")
      return err(res, 400, SESSION_CONCLUDED_MSG);

    const turnRaw =
      await prisma.testTurn.findFirst({
        where: {
          id: req.params.turnId,
          sessionId: session.id,
        },
      });
    if (!turnRaw)
      return err(res, 404, "Turn not found");
    const turn = withImageAsset(turnRaw);
    if (turn.nextPromptLockedAt != null)
      return err(
        res,
        400,
        "This turn is locked - use the latest turn to continue",
      );
    if (turn.evaluationVerdict == null)
      return err(
        res,
        400,
        "Analyze this turn before re-suggesting a follow-up",
      );
    const pasted =
      turn.pastedModelResponse?.trim();
    const hasImageOutput =
      (typeof turn.pastedModelImageDataUrl ===
        "string" &&
        turn.pastedModelImageDataUrl.length > 0) ||
      (typeof turn.pastedModelImageAssetPath ===
        "string" &&
        turn.pastedModelImageAssetPath.trim()
          .length > 0);
    if (!pasted && !hasImageOutput)
      return err(
        res,
        400,
        "No pasted response or image output on this turn to re-suggest from",
      );
    const pastedForResuggest =
      pasted ||
      "[No pasted text response. Re-suggest based on image-output context and prior evaluation summary.]";

    const aggressive =
      parsed.data.aggressive === true;
    const nextPromptInstruction =
      parsed.data.nextPromptInstruction?.trim() ||
      null;

    let out: Awaited<
      ReturnType<
        typeof resuggestRecommendedNextPromptRouted
      >
    >;
    try {
      out = await resuggestRecommendedNextPromptRouted(
        {
          category: session.category,
          strategy: session.strategy,
          generatedPrompt: turn.generatedPrompt,
          pastedResponse: pastedForResuggest,
          objective: session.objective,
          aggressive,
          nextPromptInstruction,
          priorVerdict: turn.evaluationVerdict,
          evaluationSummary:
            turn.evaluationSummary ?? "",
          priorRecommendedNextPrompt:
            turn.recommendedNextPrompt,
          hasImageOutput,
        },
        parsed.data.providerOverride ??
          providerFromMeta(turn.generatedMeta),
      );
    } catch (e) {
      console.error(e);
      return err(
        res,
        502,
        "Re-suggest failed - try again or use demo mode without API key",
        e instanceof Error ? e.message : e,
      );
    }

    const prevRaw = turn.heuristicFlags;
    const prevFlags =
      prevRaw != null &&
      typeof prevRaw === "object" &&
      !Array.isArray(prevRaw)
        ? {
            ...(prevRaw as Record<
              string,
              unknown
            >),
          }
        : {};

    await prisma.testTurn.update({
      where: { id: turn.id },
      data: {
        recommendedNextPrompt:
          out.recommendedNextPrompt,
        heuristicFlags: {
          ...prevFlags,
          aggressiveFollowUpRequested: aggressive,
          assistantRecommendedNextPrompt:
            out.recommendedNextPrompt,
          analystEditedRecommendedNextPrompt: false,
          ...(nextPromptInstruction
            ? { nextPromptInstruction }
            : {}),
        } as Prisma.InputJsonValue,
      },
    });

    await prisma.testSession.update({
      where: { id: session.id },
      data: { updatedAt: new Date() },
    });

    const full =
      await prisma.testSession.findUnique({
        where: { id: session.id },
        include: {
          turns: {
            orderBy: { turnNumber: "asc" },
          },
        },
      });
    res.json(full);
  }),
);

router.post(
  "/:id/turns/:turnId/resuggest-first",
  asyncHandler(async (req, res) => {
    const session =
      await prisma.testSession.findUnique({
        where: { id: req.params.id },
      });
    if (!session)
      return err(res, 404, "Session not found");
    if (session.status === "ARCHIVED")
      return err(res, 400, SESSION_CONCLUDED_MSG);

    const turnRaw =
      await prisma.testTurn.findFirst({
        where: {
          id: req.params.turnId,
          sessionId: session.id,
        },
      });
    if (!turnRaw)
      return err(res, 404, "Turn not found");
    const turn = withImageAsset(turnRaw);
    if (turn.turnNumber !== 1)
      return err(
        res,
        400,
        "Re-suggest first prompt is only available on turn 1",
      );
    if (turn.nextPromptLockedAt != null)
      return err(
        res,
        400,
        "This turn is locked - first prompt can no longer be replaced",
      );
    if (turn.evaluationVerdict != null)
      return err(
        res,
        400,
        "First prompt already analyzed. Start from a new session to regenerate the first prompt.",
      );

    const latest =
      await prisma.testTurn.findFirst({
        where: { sessionId: session.id },
        orderBy: { turnNumber: "desc" },
        select: { id: true, turnNumber: true },
      });
    if (!latest || latest.id !== turn.id)
      return err(
        res,
        400,
        "Only the latest turn can be re-suggested",
      );

    const aggressive = aggressiveFromMeta(
      turn.generatedMeta,
    );
    const provider =
      providerFromMeta(turn.generatedMeta);
    const attackVector = resolveAttackVector(
      session.strategy,
    );

    let gen: Awaited<
      ReturnType<
        typeof generateAdversarialPromptRouted
      >
    >;
    try {
      gen = await generateAdversarialPromptRouted(
        {
          modelType: session.modelType,
          modelNameOrNotes:
            session.modelNameOrNotes,
          category: session.category,
          strategy: session.strategy,
          objective: session.objective,
          aggressive,
        },
        provider,
      );
    } catch (e) {
      console.error(e);
      return err(
        res,
        502,
        "Could not re-suggest first prompt",
        e instanceof Error ? e.message : e,
      );
    }

    await prisma.testTurn.update({
      where: { id: turn.id },
      data: {
        generatedPrompt: gen.generatedPrompt,
        generatedMeta: {
          objective: gen.objective,
          pressurePoint: gen.pressurePoint,
          notes: gen.notes ?? null,
          aggressiveFraming: aggressive,
          attackVector: attackVector.vector,
          attackVectorLabel: attackVector.label,
          ...(provider ? { provider } : {}),
        } as Prisma.InputJsonValue,
      },
    });

    await prisma.testSession.update({
      where: { id: session.id },
      data: { updatedAt: new Date() },
    });

    const full =
      await prisma.testSession.findUnique({
        where: { id: session.id },
        include: {
          turns: {
            orderBy: { turnNumber: "asc" },
          },
        },
      });
    return res.json(full);
  }),
);

router.post(
  "/:id/turns/:turnId/lock-and-advance",
  asyncHandler(async (req, res) => {
    const parsed =
      LockAndAdvanceBodySchema.safeParse(
        req.body,
      );
    if (!parsed.success)
      return err(
        res,
        400,
        "Invalid body",
        parsed.error.flatten(),
      );

    const session =
      await prisma.testSession.findUnique({
        where: { id: req.params.id },
      });
    if (!session)
      return err(res, 404, "Session not found");
    if (session.status === "ARCHIVED")
      return err(res, 400, SESSION_CONCLUDED_MSG);

    const turn = await prisma.testTurn.findFirst({
      where: {
        id: req.params.turnId,
        sessionId: session.id,
      },
    });
    if (!turn)
      return err(res, 404, "Turn not found");

    const latest =
      await prisma.testTurn.findFirst({
        where: { sessionId: session.id },
        orderBy: { turnNumber: "desc" },
        select: { id: true, turnNumber: true },
      });
    if (!latest || latest.id !== turn.id)
      return err(
        res,
        400,
        "Only the current (latest) turn can be locked to start the next one",
      );

    if (turn.evaluationVerdict == null)
      return err(
        res,
        400,
        "Analyze this turn before locking and continuing",
      );
    if (turn.nextPromptLockedAt != null)
      return err(
        res,
        400,
        "This turn is already locked",
      );

    const text =
      parsed.data.recommendedNextPrompt.trim();
    const prevRaw = turn.heuristicFlags;
    const prevFlags =
      prevRaw != null &&
      typeof prevRaw === "object" &&
      !Array.isArray(prevRaw)
        ? {
            ...(prevRaw as Record<
              string,
              unknown
            >),
          }
        : {};

    const lockedAt = new Date();
    const assistantSnap =
      typeof prevFlags.assistantRecommendedNextPrompt ===
      "string"
        ? prevFlags.assistantRecommendedNextPrompt.trim()
        : "";
    const editBaseline =
      assistantSnap ||
      (turn.recommendedNextPrompt ?? "").trim();
    const inheritedProvider = providerFromMeta(
      turn.generatedMeta,
    );
    const inheritedAttackVector =
      turn.generatedMeta &&
      typeof turn.generatedMeta === "object"
        ? (
            turn.generatedMeta as {
              attackVector?: unknown;
              attackVectorLabel?: unknown;
            }
          )
        : {};

    await prisma.$transaction([
      prisma.testTurn.update({
        where: { id: turn.id },
        data: {
          recommendedNextPrompt: text,
          nextPromptLockedAt: lockedAt,
          heuristicFlags: {
            ...prevFlags,
            analystEditedRecommendedNextPrompt:
              text !== editBaseline,
          } as Prisma.InputJsonValue,
        },
      }),
      prisma.testTurn.create({
        data: {
          sessionId: session.id,
          turnNumber: turn.turnNumber + 1,
          generatedPrompt: text,
          generatedMeta: {
            seededFromTurnId: turn.id,
            seededFromTurnNumber: turn.turnNumber,
            lockedPreviousTurnAt:
              lockedAt.toISOString(),
            ...(inheritedProvider
              ? { provider: inheritedProvider }
              : {}),
            ...(typeof inheritedAttackVector.attackVector ===
            "string"
              ? {
                  attackVector:
                    inheritedAttackVector.attackVector,
                }
              : {}),
            ...(typeof inheritedAttackVector.attackVectorLabel ===
            "string"
              ? {
                  attackVectorLabel:
                    inheritedAttackVector.attackVectorLabel,
                }
              : {}),
          },
        },
      }),
      prisma.testSession.update({
        where: { id: session.id },
        data: { updatedAt: new Date() },
      }),
    ]);

    const full =
      await prisma.testSession.findUnique({
        where: { id: session.id },
        include: {
          turns: {
            orderBy: { turnNumber: "asc" },
          },
        },
      });
    res.status(201).json(full);
  }),
);

router.post(
  "/:id/turns/:turnId/analyze",
  asyncHandler(async (req, res) => {
    const parsed =
      AnalyzeTurnBodySchema.safeParse(req.body);
    if (!parsed.success)
      return err(
        res,
        400,
        "Invalid body",
        parsed.error.flatten(),
      );

    const session =
      await prisma.testSession.findUnique({
        where: { id: req.params.id },
      });
    if (!session)
      return err(res, 404, "Session not found");
    if (session.status === "ARCHIVED")
      return err(res, 400, SESSION_CONCLUDED_MSG);

    const turnRaw =
      await prisma.testTurn.findFirst({
        where: {
          id: req.params.turnId,
          sessionId: session.id,
        },
      });
    if (!turnRaw)
      return err(res, 404, "Turn not found");
    const turn = withImageAsset(turnRaw);
    if (turn.nextPromptLockedAt != null)
      return err(
        res,
        400,
        "This turn is locked - analyze only the latest turn",
      );

    const repoRoot = getRepoRoot();
    const resolvedImageDataUrl =
      await resolveImageDataUrlForAnalysis(
        repoRoot,
        turn,
        parsed.data.pastedImageDataUrl,
      );
    const hasImageAttached =
      typeof resolvedImageDataUrl === "string" &&
      resolvedImageDataUrl.length > 0;

    const flags = runHeuristics(
      parsed.data.pastedResponse,
      {
        hasImage: hasImageAttached,
      },
    );
    const aggressiveFollowUp =
      parsed.data.aggressive === true;
    const nextPromptInstruction =
      parsed.data.nextPromptInstruction?.trim() ||
      null;
    let analysis: Awaited<
      ReturnType<typeof analyzePastedResponseRouted>
    >;
    try {
      analysis = await analyzePastedResponseRouted(
        {
          category: session.category,
          strategy: session.strategy,
          generatedPrompt: turn.generatedPrompt,
          pastedResponse:
            parsed.data.pastedResponse.trim(),
          objective: session.objective,
          aggressive: aggressiveFollowUp,
          nextPromptInstruction,
          pastedImageDataUrl:
            resolvedImageDataUrl ?? undefined,
          modelType: session.modelType,
        },
        parsed.data.providerOverride ??
          providerFromMeta(turn.generatedMeta),
      );
    } catch (e) {
      console.error(e);
      return err(
        res,
        502,
        "Analysis failed - try again or use demo mode without API key",
        e instanceof Error ? e.message : e,
      );
    }

    const confidence = adjustConfidence(
      analysis.confidence,
      flags,
    );

    let imagePersist:
      | {
          pastedModelImageDataUrl: string | null;
          pastedModelImageAssetPath:
            | string
            | null;
        }
      | undefined;
    if (
      parsed.data.pastedImageDataUrl !== undefined
    ) {
      const v = parsed.data.pastedImageDataUrl;
      if (v === null) {
        await removeTurnImageAsset(
          repoRoot,
          turn.pastedModelImageAssetPath,
        );
        imagePersist = {
          pastedModelImageDataUrl: null,
          pastedModelImageAssetPath: null,
        };
      } else if (/^data:image\//i.test(v)) {
        await removeTurnImageAsset(
          repoRoot,
          turn.pastedModelImageAssetPath,
        );
        const rel =
          await saveTurnImageFromDataUrl(
            repoRoot,
            session.id,
            turn.id,
            v,
          );
        if (!rel)
          return err(
            res,
            400,
            "Could not save image - use PNG, JPEG, GIF, or WebP base64 data URL",
          );
        imagePersist = {
          pastedModelImageDataUrl: null,
          pastedModelImageAssetPath: rel,
        };
      } else {
        await removeTurnImageAsset(
          repoRoot,
          turn.pastedModelImageAssetPath,
        );
        imagePersist = {
          pastedModelImageDataUrl: v.trim(),
          pastedModelImageAssetPath: null,
        };
      }
    }

    const updated = await prisma.testTurn.update({
      where: { id: turn.id },
      data: {
        pastedModelResponse:
          parsed.data.pastedResponse.trim(),
        ...(imagePersist
          ? asTestTurnImageUpdate(imagePersist)
          : {}),
        evaluationVerdict: analysis.verdict,
        evaluationScore: analysis.score,
        evaluationConfidence: confidence,
        evaluationReasoning: analysis.reasoning,
        observedWeakness:
          analysis.observedWeakness,
        recommendedNextPrompt:
          analysis.recommendedNextPrompt,
        evaluationSummary:
          analysis.evaluationSummary,
        quotedFailures:
          analysis.quotedFailures as Prisma.InputJsonValue,
        discriminatoryBias:
          analysis.discriminatoryBias as Prisma.InputJsonValue,
        explicitContentReport:
          analysis.explicitContent as Prisma.InputJsonValue,
        misinformationReport:
          analysis.misinformation as Prisma.InputJsonValue,
        categorySpecificReport:
          analysis.categorySpecific as Prisma.InputJsonValue,
        heuristicFlags: {
          ...flags,
          aggressiveFollowUpRequested:
            aggressiveFollowUp,
          assistantRecommendedNextPrompt:
            analysis.recommendedNextPrompt,
          ...(nextPromptInstruction
            ? { nextPromptInstruction }
            : {}),
        },
      },
    });

    await prisma.testSession.update({
      where: { id: session.id },
      data: { updatedAt: new Date() },
    });

    res.json(updated);
  }),
);

router.post(
  "/:id/turns/next",
  asyncHandler(async (_req, res) => {
    return err(
      res,
      400,
      "Use “Save prompt & lock - start next turn” on the workbench (POST …/lock-and-advance) instead of this endpoint",
    );
  }),
);

function jsonEscapeCell(s: string): string {
  if (/[",\n\r]/.test(s))
    return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Turns analyzed before on-disk assets existed may still store huge data URLs.
 * Persist them under assets/ and clear the DB blob so Markdown can link files.
 */
async function materializeInlineDataUrlImages(
  session: SessionWithTurns,
): Promise<SessionWithTurns> {
  const repoRoot = getRepoRoot();
  let changed = false;
  for (const t of session.turns) {
    const tw = withImageAsset(t);
    if (tw.pastedModelImageAssetPath?.trim())
      continue;
    const raw =
      tw.pastedModelImageDataUrl?.trim();
    if (!raw?.startsWith("data:image/")) continue;
    const rel = await saveTurnImageFromDataUrl(
      repoRoot,
      session.id,
      t.id,
      raw,
    );
    if (!rel) continue;
    await prisma.testTurn.update({
      where: { id: t.id },
      data: asTestTurnImageUpdate({
        pastedModelImageAssetPath: rel,
        pastedModelImageDataUrl: null,
      }),
    });
    changed = true;
  }
  if (!changed) return session;
  const full =
    await prisma.testSession.findUnique({
      where: { id: session.id },
      include: {
        turns: { orderBy: { turnNumber: "asc" } },
      },
    });
  return full as SessionWithTurns;
}

router.get(
  "/:id/export",
  asyncHandler(async (req, res) => {
    const format =
      (req.query.format as string) || "json";
    let session =
      await prisma.testSession.findUnique({
        where: { id: req.params.id },
        include: {
          turns: {
            orderBy: { turnNumber: "asc" },
          },
        },
      });
    if (!session)
      return err(res, 404, "Session not found");

    if (
      (format === "md" ||
        format === "markdown") &&
      session.status !== "ARCHIVED"
    ) {
      await prisma.testSession.update({
        where: { id: session.id },
        data: { status: "ARCHIVED" },
      });
      session =
        await prisma.testSession.findUnique({
          where: { id: session.id },
          include: {
            turns: {
              orderBy: { turnNumber: "asc" },
            },
          },
        });
      if (!session)
        return err(res, 404, "Session not found");
    }

    session =
      await materializeInlineDataUrlImages(
        session as SessionWithTurns,
      );

    if (format === "csv") {
      const headers = [
        "sessionId",
        "title",
        "modelType",
        "category",
        "strategy",
        "turnNumber",
        "generatedPrompt",
        "pastedModelResponse",
        "pastedModelImageAttached",
        "evaluationVerdict",
        "evaluationScore",
        "evaluationConfidence",
        "evaluationReasoning",
        "observedWeakness",
        "recommendedNextPrompt",
        "evaluationSummary",
        "quotedFailures",
        "discriminatoryBias",
        "explicitContentReport",
        "misinformationReport",
        "categorySpecificReport",
        "nextPromptLockedAt",
      ];
      const lines = [headers.join(",")];
      for (const t of session.turns) {
        const row = [
          session.id,
          session.title,
          session.modelType,
          session.category,
          session.strategy,
          String(t.turnNumber),
          t.generatedPrompt,
          t.pastedModelResponse ?? "",
          t.pastedModelImageDataUrl ||
          withImageAsset(t)
            .pastedModelImageAssetPath
            ? "yes"
            : "",
          t.evaluationVerdict ?? "",
          t.evaluationScore ?? "",
          t.evaluationConfidence ?? "",
          t.evaluationReasoning ?? "",
          t.observedWeakness ?? "",
          t.recommendedNextPrompt ?? "",
          t.evaluationSummary ?? "",
          t.quotedFailures != null
            ? JSON.stringify(t.quotedFailures)
            : "",
          t.discriminatoryBias != null
            ? JSON.stringify(t.discriminatoryBias)
            : "",
          t.explicitContentReport != null
            ? JSON.stringify(
                t.explicitContentReport,
              )
            : "",
          t.misinformationReport != null
            ? JSON.stringify(
                t.misinformationReport,
              )
            : "",
          t.categorySpecificReport != null
            ? JSON.stringify(
                t.categorySpecificReport,
              )
            : "",
          t.nextPromptLockedAt != null
            ? t.nextPromptLockedAt.toISOString()
            : "",
        ].map((c) => jsonEscapeCell(String(c)));
        lines.push(row.join(","));
      }
      res.setHeader(
        "Content-Type",
        "text/csv; charset=utf-8",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="prompttrace-${session.id}.csv"`,
      );
      return res.send(lines.join("\r\n"));
    }

    if (
      format === "md" ||
      format === "markdown"
    ) {
      const root = getRepoRoot();
      const reportsAbs = path.join(
        root,
        ...GENERATED_REPORTS_DIR.split("/"),
      );
      await fs.mkdir(reportsAbs, {
        recursive: true,
      });
      const md =
        buildSessionMarkdownReport(session);
      const safeSlug =
        session.title
          .replace(/[^\w\-]+/g, "_")
          .slice(0, 80) || "report";
      const reportFileName = `prompttrace-${session.id}-${safeSlug}.md`;
      await fs.writeFile(
        path.join(reportsAbs, reportFileName),
        md,
        "utf8",
      );
      res.setHeader(
        "Content-Type",
        "text/markdown; charset=utf-8",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="prompttrace-${session.id}-report.md"`,
      );
      return res.send(md);
    }

    res.setHeader(
      "Content-Type",
      "application/json; charset=utf-8",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="prompttrace-${session.id}.json"`,
    );
    return res.send(
      JSON.stringify(
        {
          session: {
            id: session.id,
            title: session.title,
            modelType: session.modelType,
            modelNameOrNotes:
              session.modelNameOrNotes,
            category: session.category,
            strategy: session.strategy,
            objective: session.objective,
            status: session.status,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
          },
          turns: session.turns.map((t) => ({
            id: t.id,
            turnNumber: t.turnNumber,
            generatedPrompt: t.generatedPrompt,
            generatedMeta: t.generatedMeta,
            pastedModelResponse:
              t.pastedModelResponse,
            pastedModelImageDataUrl:
              t.pastedModelImageDataUrl,
            pastedModelImageAssetPath:
              withImageAsset(t)
                .pastedModelImageAssetPath,
            evaluationVerdict:
              t.evaluationVerdict,
            evaluationScore: t.evaluationScore,
            evaluationConfidence:
              t.evaluationConfidence,
            evaluationReasoning:
              t.evaluationReasoning,
            observedWeakness: t.observedWeakness,
            recommendedNextPrompt:
              t.recommendedNextPrompt,
            evaluationSummary:
              t.evaluationSummary,
            quotedFailures: t.quotedFailures,
            discriminatoryBias:
              t.discriminatoryBias,
            explicitContentReport:
              t.explicitContentReport,
            misinformationReport:
              t.misinformationReport,
            categorySpecificReport:
              t.categorySpecificReport,
            heuristicFlags: t.heuristicFlags,
            nextPromptLockedAt:
              t.nextPromptLockedAt,
            createdAt: t.createdAt,
          })),
        },
        null,
        2,
      ),
    );
  }),
);

export default router;
