import type { TestSession, TestTurn } from "@prisma/client";
import { getCategoryEvaluationTargets } from "@prompttrace/shared";

/**
 * Turn row used when building exports. Intersection keeps this file type-correct
 * if the editor resolves an older generated `TestTurn` (before `pastedModelImageAssetPath`).
 */
export type ReportTurn = TestTurn & {
  pastedModelImageAssetPath?: string | null;
};

export type SessionWithTurns = TestSession & { turns: ReportTurn[] };

/** Reserved for future export flags; Markdown reports never embed model-output images. */
export type SessionMarkdownReportOptions = Record<string, never>;

const EXCERPT_PROMPT = 6000;
const EXCERPT_RESPONSE = 8000;
const EXCERPT_FOLLOWUP = 4000;

function iso(d: Date): string {
  return d.toISOString();
}

function fence(lang: string, body: string): string {
  const esc = body.replace(/\n```/g, "\n\\`\\`\\`");
  return "```" + lang + "\n" + esc + "\n```\n";
}

function excerpt(s: string | null | undefined, max: number): string {
  if (s == null || !String(s).trim()) return "*(none)*";
  const t = String(s).trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + "\n\n… *(truncated for report length)*";
}

/**
 * Markdown exports intentionally omit pixels and image URLs so reports are safer to share
 * and store. Imagery remains in PromptTrace and on-disk `assets/` for authorized review.
 */
function imageOutputNoticeForTurn(
  dataUrlOrLink: string | null | undefined,
  assetPathPosix: string | null | undefined,
  turnNumber: number,
): string {
  const raw = dataUrlOrLink?.trim() ?? "";
  const hasHttp = /^https?:\/\//i.test(raw);
  const hasData = raw.startsWith("data:image/");
  const hasAsset = !!assetPathPosix?.trim();
  if (!hasHttp && !hasData && !hasAsset) return "";

  const parts: string[] = [
    `#### Image output (model response)\n\n`,
    `*Turn ${turnNumber} included an image used during evaluation (saved file and/or inline or linked reference). **No image data, links, or thumbnails appear in this Markdown export** — use PromptTrace or your authorized \`assets/\` workflow to view pixels.*\n\n`,
  ];
  return parts.join("");
}

function quotedFailuresMd(q: unknown): string {
  if (!Array.isArray(q) || q.length === 0)
    return "*No quoted failure excerpts recorded for this turn.*\n";
  const parts: string[] = [];
  for (let i = 0; i < q.length; i++) {
    const item = q[i];
    if (!item || typeof item !== "object") continue;
    const quote = (item as { quote?: unknown }).quote;
    const explanation = (item as { explanation?: unknown }).explanation;
    const qs = typeof quote === "string" ? quote : "";
    const es = typeof explanation === "string" ? explanation : "";
    parts.push(
      `**${i + 1}.** *(verbatim from model output)*\n\n` +
        (qs
          ? qs
              .split("\n")
              .map((line) => "> " + line)
              .join("\n")
          : "> *(empty)*") +
        "\n\n" +
        (es ? `*Why it matters:* ${es}\n` : "") +
        "\n",
    );
  }
  return parts.join("") || "*No quoted failure excerpts.*\n";
}

function jsonSignalBlock(title: string, v: unknown): string {
  if (v == null) return "";
  if (typeof v !== "object") return "";
  const o = v as Record<string, unknown>;
  if (o.detected !== true) return "";
  let out = `#### ${title}\n\n`;
  if (typeof o.summary === "string" && o.summary.trim())
    out += o.summary.trim() + "\n\n";
  out += fence("json", JSON.stringify(v, null, 2));
  return out + "\n";
}

function verdictRank(v: string): number {
  if (v === "FAILED") return 2;
  if (v === "BORDERLINE") return 1;
  return 0;
}

function buildOutcomeSection(turns: TestTurn[]): string {
  const analyzed = turns.filter((t) => t.evaluationVerdict != null);
  const lines: string[] = [];

  lines.push("## Outcome summary\n");
  lines.push(
    "*Scores and verdicts come from the in-app evaluator (LLM + heuristics). They are **indicative**, not a certification of production safety.*\n",
  );

  if (analyzed.length === 0) {
    lines.push(
      "**Status:** No turns have been analyzed yet — run **Analyze** on the workbench, then re-export.\n",
    );
    return lines.join("\n");
  }

  const verdicts = analyzed.map((t) => t.evaluationVerdict!);
  const scores = analyzed
    .map((t) => t.evaluationScore)
    .filter((n): n is number => typeof n === "number");

  let worst: "SAFE" | "BORDERLINE" | "FAILED" = "SAFE";
  for (const v of verdicts) {
    if (verdictRank(v) > verdictRank(worst)) worst = v;
  }

  const last = analyzed[analyzed.length - 1]!;
  const idxFailed = analyzed.findIndex((t) => t.evaluationVerdict === "FAILED");
  const idxIssue = analyzed.findIndex(
    (t) =>
      t.evaluationVerdict === "FAILED" ||
      t.evaluationVerdict === "BORDERLINE",
  );
  const safeAfterFailed =
    idxFailed >= 0 &&
    analyzed
      .slice(idxFailed + 1)
      .some((t) => t.evaluationVerdict === "SAFE");
  const safeAfterIssue =
    idxIssue >= 0 &&
    analyzed
      .slice(idxIssue + 1)
      .some((t) => t.evaluationVerdict === "SAFE");

  lines.push(`- **Analyzed turns:** ${analyzed.length} of ${turns.length}`);
  if (scores.length > 0) {
    const sum = scores.reduce((a, b) => a + b, 0);
    const avg = Math.round(sum / scores.length);
    lines.push(
      `- **Evaluator safety scores (0–100, higher = safer handling):** average **${avg}**, min **${Math.min(...scores)}**, max **${Math.max(...scores)}**`,
    );
  }
  lines.push(`- **Strongest concern seen in any turn:** **${worst}**`);
  lines.push(
    `- **Latest analyzed turn:** **${last.evaluationVerdict}** (score ${last.evaluationScore ?? "—"}, confidence ${last.evaluationConfidence ?? "—"})`,
  );
  lines.push(`- **Verdict sequence:** ${verdicts.join(" → ")}`);
  lines.push("");

  lines.push("### Red-team interpretation\n");
  lines.push(
    "A **FAILED** or **BORDERLINE** turn means the evaluator saw policy risk *in that exchange*. That is valuable evidence for your report.\n",
  );
  lines.push("");
  lines.push(
    "**Important:** If the model **failed in a serious way early** but **later returned to safer behavior**—refusing, blocking, or steering away from disallowed content—that pattern can still be a **successful test**: you **stressed the system**, observed where it **broke or bent**, and then saw it **recover** toward policy-aligned behavior. In that story the initial failure is the **finding**; the later guardrails show how the stack **can** behave when engaged. Frame both phases explicitly for readers.\n",
  );
  lines.push("");

  if (safeAfterFailed) {
    lines.push(
      "> **Pattern — “we broke it, then it recovered”:** This session includes at least one **FAILED** turn **followed by SAFE handling** in a later turn. That is often a **successful red-team outcome**: you demonstrated where the model **broke policy**, then showed that **blocking / refusals** returned under continued pressure. Report **both** the failure and the recovery.\n",
    );
    lines.push("");
  } else if (
    safeAfterIssue &&
    !verdicts.includes("FAILED") &&
    verdicts.includes("BORDERLINE")
  ) {
    lines.push(
      "> **Pattern:** **BORDERLINE** handling appears before **SAFE** later turns — note the shift and whether guardrails strengthened across the dialogue.\n",
    );
    lines.push("");
  }

  let headline = "**Session test result (headline):** ";
  if (worst === "FAILED")
    headline +=
      "Policy failures were observed in at least one turn — see turn-level evidence.";
  else if (worst === "BORDERLINE")
    headline +=
      "Borderline or ambiguous handling was observed — review excerpts and summaries.";
  else headline += "No FAILED turns in the evaluated exchanges; still review context.";

  lines.push(headline + "\n");

  return lines.join("\n");
}

export function buildSessionMarkdownReport(
  session: SessionWithTurns,
  _options?: SessionMarkdownReportOptions,
): string {
  const parts: string[] = [];

  parts.push(`# PromptTrace session report\n`);
  parts.push(`**Session:** ${session.title}\n`);
  parts.push(`**Exported:** ${iso(new Date())} (UTC)\n`);
  parts.push(`**Session ID:** \`${session.id}\`\n`);
  parts.push(
    "\n> **Export policy:** Model-output **images are not included** in Markdown (no pixels, URLs, or file links) so reports are safer to distribute. Open the session in PromptTrace or use secured storage for imagery.\n",
  );
  parts.push("\n---\n");

  parts.push("## Methodology & scope\n");
  parts.push(`| Field | Value |\n| --- | --- |\n`);
  parts.push(`| Model type | ${session.modelType} |\n`);
  parts.push(
    `| Target notes | ${session.modelNameOrNotes?.trim() || "—"} |\n`,
  );
  parts.push(`| Test category | ${session.category} |\n`);
  parts.push(`| Attack strategy | ${session.strategy} |\n`);
  parts.push(
    `| Session objective | ${session.objective?.trim() || "—"} |\n`,
  );
  parts.push(`| Status | ${session.status} |\n`);
  parts.push(
    `| Created | ${iso(session.createdAt)} |\n| Updated | ${iso(session.updatedAt)} |\n`,
  );
  parts.push("\n");
  parts.push("### Category evaluation focus (assistant context)\n\n");
  parts.push(getCategoryEvaluationTargets(session.category) + "\n\n");
  parts.push("---\n");

  parts.push(buildOutcomeSection(session.turns));

  parts.push("---\n");
  parts.push("## Turn-by-turn evidence\n");

  for (const t of session.turns) {
    parts.push(`\n### Turn ${t.turnNumber}\n`);
    parts.push(
      `**Turn ID:** \`${t.id}\` · **Created:** ${iso(t.createdAt)}\n`,
    );
    if (t.nextPromptLockedAt)
      parts.push(
        `**Follow-up locked at:** ${iso(t.nextPromptLockedAt)} *(prompt for next turn was committed)*\n`,
      );
    parts.push(
      `\n**Analysis status:** ${t.evaluationVerdict ? `Evaluated (**${t.evaluationVerdict}**)` : "Not analyzed yet"}\n`,
    );

    parts.push("\n#### Test prompt (sent to target)\n\n");
    parts.push(fence("text", excerpt(t.generatedPrompt, EXCERPT_PROMPT)));

    parts.push("\n#### Model text response / analyst notes\n\n");
    parts.push(
      fence(
        "text",
        excerpt(t.pastedModelResponse, EXCERPT_RESPONSE),
      ),
    );

    parts.push(
      "\n" +
        imageOutputNoticeForTurn(
          t.pastedModelImageDataUrl,
          t.pastedModelImageAssetPath,
          t.turnNumber,
        ),
    );

    if (t.evaluationVerdict) {
      parts.push("#### Evaluator assessment\n\n");
      parts.push(
        `| Verdict | Score | Confidence |\n| --- | --- | --- |\n| **${t.evaluationVerdict}** | ${t.evaluationScore ?? "—"} | ${t.evaluationConfidence ?? "—"} |\n\n`,
      );
      if (t.evaluationSummary?.trim()) {
        parts.push("**Summary**\n\n" + t.evaluationSummary.trim() + "\n\n");
      }
      if (t.evaluationReasoning?.trim()) {
        parts.push(
          "**Reasoning**\n\n" + t.evaluationReasoning.trim() + "\n\n",
        );
      }
      if (t.observedWeakness?.trim()) {
        parts.push(
          "**Observed weakness**\n\n" + t.observedWeakness.trim() + "\n\n",
        );
      }

      parts.push("#### Failure excerpts (verbatim from model output)\n\n");
      parts.push(quotedFailuresMd(t.quotedFailures));

      parts.push(jsonSignalBlock("Bias / hate / targeting", t.discriminatoryBias));
      parts.push(jsonSignalBlock("Explicit content", t.explicitContentReport));
      parts.push(jsonSignalBlock("Misinformation", t.misinformationReport));
      parts.push(
        jsonSignalBlock("Category-specific signals", t.categorySpecificReport),
      );

      if (t.recommendedNextPrompt?.trim()) {
        parts.push("#### Suggested follow-up prompt (evaluator)\n\n");
        parts.push(
          fence(
            "text",
            excerpt(t.recommendedNextPrompt, EXCERPT_FOLLOWUP),
          ),
        );
      }
    } else {
      parts.push(
        "\n*This turn has not been analyzed — no verdict, scores, or structured signals yet.*\n",
      );
    }

    if (t.generatedMeta != null) {
      parts.push("\n#### Generation metadata (JSON)\n\n");
      parts.push(fence("json", JSON.stringify(t.generatedMeta, null, 2)));
    }
    if (t.heuristicFlags != null && typeof t.heuristicFlags === "object") {
      parts.push("\n#### Heuristic flags (JSON)\n\n");
      parts.push(fence("json", JSON.stringify(t.heuristicFlags, null, 2)));
    }
  }

  parts.push("\n---\n");
  parts.push("## Disclaimer\n\n");
  parts.push(
    "This report is generated from PromptTrace session data and automated evaluation. It does **not** replace human judgment, vendor safety reviews, or compliance sign-off. Use it as structured documentation of a controlled test run.\n",
  );

  return parts.join("\n");
}
