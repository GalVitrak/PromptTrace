import fs from "node:fs/promises";
import path from "node:path";
import type {
  CreateCtfRunBody,
  CtfResultLabel,
  CtfRun,
  CtfTurn,
} from "@prompttrace/shared";
import {
  CtfRunSchema,
  CtfTurnSchema,
} from "@prompttrace/shared";
import { getRepoRoot } from "./sessionAssets.js";

const CTF_RUNS_DIR = "docs/generated_ctf_runs";

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(): string {
  return (
    "ctf-" +
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36)
  );
}

function runPath(id: string): string {
  return path.join(
    getRepoRoot(),
    CTF_RUNS_DIR,
    `${id}.json`,
  );
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(
    path.join(getRepoRoot(), CTF_RUNS_DIR),
    { recursive: true },
  );
}

export async function createCtfRun(
  input: CreateCtfRunBody,
): Promise<CtfRun> {
  await ensureDir();
  const t = nowIso();
  const run: CtfRun = {
    id: randomId(),
    timestamp: t,
    mode: "CTF",
    attackerModel: input.attackerModel,
    targetModel: input.targetModel,
    judgeModel: input.judgeModel,
    attackerProvider: input.attackerProvider,
    targetProvider: input.targetProvider,
    judgeProvider: input.judgeProvider,
    strategyCategory: input.strategyCategory,
    strategyName: input.strategyName,
    challengeObjective: input.challengeObjective,
    flagFormatHint: input.flagFormatHint,
    difficulty: input.difficulty ?? "MEDIUM",
    guardrailProfile: input.guardrailProfile,
    systemPromptUsed: input.systemPromptUsed,
    transcript: [],
    finalResult: undefined,
    notes: input.notes,
    tags: input.tags ?? [],
    createdAt: t,
    updatedAt: t,
  };
  await saveCtfRun(run);
  return run;
}

export async function saveCtfRun(
  run: CtfRun,
): Promise<void> {
  await ensureDir();
  const validated = CtfRunSchema.parse(run);
  await fs.writeFile(
    runPath(run.id),
    JSON.stringify(validated, null, 2),
    "utf8",
  );
}

export async function getCtfRun(
  id: string,
): Promise<CtfRun | null> {
  try {
    const text = await fs.readFile(
      runPath(id),
      "utf8",
    );
    const raw = JSON.parse(text) as unknown;
    const parsed = CtfRunSchema.safeParse(raw);
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export async function listCtfRuns(): Promise<CtfRun[]> {
  await ensureDir();
  const dir = path.join(getRepoRoot(), CTF_RUNS_DIR);
  const entries = await fs.readdir(dir);
  const out: CtfRun[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -5);
    const run = await getCtfRun(id);
    if (run) out.push(run);
  }
  out.sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  return out;
}

export async function appendCtfTurn(args: {
  runId: string;
  candidateAttackPrompt: string;
  promptSent: string;
  targetResponse: string;
  judgeLabel?: CtfResultLabel;
  notes?: string;
}): Promise<CtfRun | null> {
  const run = await getCtfRun(args.runId);
  if (!run) return null;
  const turn: CtfTurn = CtfTurnSchema.parse({
    turnNumber: run.transcript.length + 1,
    candidateAttackPrompt: args.candidateAttackPrompt,
    promptSent: args.promptSent,
    targetResponse: args.targetResponse,
    judgeLabel: args.judgeLabel,
    notes: args.notes,
    createdAt: nowIso(),
  });
  run.transcript.push(turn);
  run.updatedAt = nowIso();
  await saveCtfRun(run);
  return run;
}

export async function updateCtfRun(
  id: string,
  patch: {
    finalResult?: CtfResultLabel;
    notes?: string;
    tags?: string[];
  },
): Promise<CtfRun | null> {
  const run = await getCtfRun(id);
  if (!run) return null;
  if (patch.finalResult) {
    run.finalResult = patch.finalResult;
  }
  if (patch.notes !== undefined) run.notes = patch.notes;
  if (patch.tags) run.tags = patch.tags;
  run.updatedAt = nowIso();
  await saveCtfRun(run);
  return run;
}
