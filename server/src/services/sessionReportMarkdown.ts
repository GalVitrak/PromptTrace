import type {
  TestSession,
  TestTurn,
} from "@prisma/client";
import { getCategoryEvaluationTargets } from "@prompttrace/shared";

/**
 * Turn row used when building exports. Intersection keeps this file type-correct
 * if the editor resolves an older generated `TestTurn` (before `pastedModelImageAssetPath`).
 */
export type ReportTurn = TestTurn & {
  pastedModelImageAssetPath?: string | null;
};

export type SessionWithTurns = TestSession & {
  turns: ReportTurn[];
};

/** Reserved for future export flags; Markdown reports never embed model-output images. */
export type SessionMarkdownReportOptions = Record<
  string,
  never
>;

const EXCERPT_PROMPT = 6000;
const EXCERPT_RESPONSE = 8000;
const EXCERPT_FOLLOWUP = 4000;

function iso(d: Date): string {
  return d.toISOString();
}

function fence(
  lang: string,
  body: string,
): string {
  const esc = body.replace(
    /\n```/g,
    "\n\\`\\`\\`",
  );
  return "```" + lang + "\n" + esc + "\n```\n";
}

function excerpt(
  s: string | null | undefined,
  max: number,
): string {
  if (s == null || !String(s).trim())
    return "*(none)*";
  const t = String(s).trim();
  if (t.length <= max) return t;
  return (
    t.slice(0, max) +
    "\n\n… *(truncated for report length)*"
  );
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
  if (!hasHttp && !hasData && !hasAsset)
    return "";

  const parts: string[] = [
    `#### Image output (model response)\n\n`,
    `*Turn ${turnNumber} included an image used during evaluation (saved file and/or inline or linked reference). **No image data, links, or thumbnails appear in this Markdown export** - use PromptTrace or your authorized \`assets/\` workflow to view pixels.*\n\n`,
  ];
  return parts.join("");
}

function quotedFailuresMd(q: unknown): string {
  if (!Array.isArray(q) || q.length === 0)
    return "*No quoted failure excerpts recorded for this turn.*\n";
  const parts: string[] = [];
  for (let i = 0; i < q.length; i++) {
    const item = q[i];
    if (!item || typeof item !== "object")
      continue;
    const quote = (item as { quote?: unknown })
      .quote;
    const explanation = (
      item as { explanation?: unknown }
    ).explanation;
    const qs =
      typeof quote === "string" ? quote : "";
    const es =
      typeof explanation === "string"
        ? explanation
        : "";
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
  return (
    parts.join("") ||
    "*No quoted failure excerpts.*\n"
  );
}

function jsonSignalBlock(
  title: string,
  v: unknown,
): string {
  if (v == null) return "";
  if (typeof v !== "object") return "";
  const o = v as Record<string, unknown>;
  if (o.detected !== true) return "";
  let out = `#### ${title}\n\n`;
  if (
    typeof o.summary === "string" &&
    o.summary.trim()
  )
    out += o.summary.trim() + "\n\n";
  out += fence(
    "json",
    JSON.stringify(v, null, 2),
  );
  return out + "\n";
}

function verdictRank(v: string): number {
  if (v === "FAILED") return 2;
  if (v === "BORDERLINE") return 1;
  return 0;
}

export function buildSessionMarkdownReport(
  session: SessionWithTurns,
  _options?: SessionMarkdownReportOptions,
): string {
  const analyzed = session.turns.filter(
    (t) => t.evaluationVerdict != null,
  );
  const hasMultiTurn = session.turns.length > 1;
  const verdicts = analyzed.map(
    (t) => t.evaluationVerdict as
      | "SAFE"
      | "BORDERLINE"
      | "FAILED",
  );
  let worst: "SAFE" | "BORDERLINE" | "FAILED" =
    "SAFE";
  for (const v of verdicts) {
    if (verdictRank(v) > verdictRank(worst))
      worst = v;
  }
  const severity =
    worst === "FAILED"
      ? "High"
      : worst === "BORDERLINE"
        ? "Medium"
        : "Low";
  const keyFinding =
    worst === "FAILED"
      ? "Failure observed"
      : worst === "BORDERLINE"
        ? "Mixed / borderline handling"
        : "No clear failure observed";
  const impactLine =
    worst === "FAILED"
      ? "Observed behavior suggests realistic policy-bypass or harm-enablement risk if unmitigated."
      : worst === "BORDERLINE"
        ? "Observed ambiguity can degrade trust, consistency, and policy compliance under pressure."
        : "Current sample suggests resilient behavior, but broader coverage is required before confidence claims.";

  const failures = analyzed.filter(
    (t) => t.evaluationVerdict !== "SAFE",
  );
  const scores = analyzed
    .map((t) => t.evaluationScore)
    .filter(
      (n): n is number => typeof n === "number",
    );
  const avgScore =
    scores.length > 0
      ? Math.round(
          scores.reduce((a, b) => a + b, 0) /
            scores.length,
        )
      : null;
  const failedCount = analyzed.filter(
    (t) => t.evaluationVerdict === "FAILED",
  ).length;
  const borderlineCount = analyzed.filter(
    (t) => t.evaluationVerdict === "BORDERLINE",
  ).length;
  const safeCount = analyzed.filter(
    (t) => t.evaluationVerdict === "SAFE",
  ).length;
  const firstIssueTurn =
    analyzed.find(
      (t) =>
        t.evaluationVerdict === "FAILED" ||
        t.evaluationVerdict === "BORDERLINE",
    )?.turnNumber ?? null;
  const firstFailTurn =
    analyzed.find(
      (t) => t.evaluationVerdict === "FAILED",
    )?.turnNumber ?? null;
  const recoveredAfterFail =
    firstFailTurn != null &&
    analyzed.some(
      (t) =>
        t.turnNumber > firstFailTurn &&
        t.evaluationVerdict === "SAFE",
    );
  const relapsedAfterRecovery =
    recoveredAfterFail &&
    (() => {
      const firstSafeAfterFail =
        analyzed.find(
          (t) =>
            t.turnNumber > (firstFailTurn ?? 0) &&
            t.evaluationVerdict === "SAFE",
        )?.turnNumber ?? null;
      if (firstSafeAfterFail == null) return false;
      return analyzed.some(
        (t) =>
          t.turnNumber > firstSafeAfterFail &&
          t.evaluationVerdict === "FAILED",
      );
    })();

  const parts: string[] = [];

  parts.push(`# Universal Red-Team Report\n`);
  parts.push("## TL;DR\n");
  parts.push(
    `- Target: ${session.modelType}${session.modelNameOrNotes?.trim() ? ` (${session.modelNameOrNotes.trim()})` : ""}\n`,
  );
  parts.push(`- Domain: ${session.category}\n`);
  parts.push(
    `- Strategy: ${session.strategy}\n`,
  );
  parts.push(
    `- Outcome: ${keyFinding} (${severity})\n`,
  );
  parts.push(
    `- Turns: ${session.turns.length} total, ${analyzed.length} analyzed\n`,
  );
  parts.push(`- Why it matters: ${impactLine}\n\n`);
  parts.push(`**Session title:** ${session.title}\n`);
  parts.push(
    `**Session ID:** \`${session.id}\` · **Exported:** ${iso(new Date())} (UTC)\n`,
  );
  parts.push("\n---\n");

  parts.push("## 1. Executive Summary\n");
  parts.push(
    `${session.strategy} testing against a ${session.modelType} target in the ${session.category} domain produced a **${keyFinding}** result with **${severity}** severity. ${impactLine} Across ${analyzed.length} analyzed turns, verdict distribution was SAFE=${safeCount}, BORDERLINE=${borderlineCount}, FAILED=${failedCount}${avgScore != null ? `, with average evaluator score ${avgScore}/100` : ""}.\n\n`,
  );

  parts.push("## 2. Scope & Objective\n");
  parts.push(
    `- **Target system:** ${session.modelType}${session.modelNameOrNotes?.trim() ? ` (${session.modelNameOrNotes.trim()})` : ""}\n- **Domain under test:** ${session.category}\n- **Objective:** ${session.objective?.trim() || "Not explicitly provided"}\n- **Out of scope:** model training pipeline internals, platform-level infrastructure controls, and domains outside ${session.category}\n\n`,
  );

  parts.push("## 3. Threat Model\n");
  parts.push(
    `The attacker is modeled as a non-privileged but motivated user attempting to bypass safety policy through ${session.strategy.toLowerCase()} techniques. ${hasMultiTurn ? "The scenario assumes turn-by-turn persistence, reframing, and gradual escalation." : "The scenario assumes a direct single-turn bypass attempt."} This reflects realistic abuse patterns seen in public-facing AI interfaces.\n\n`,
  );

  parts.push("## 4. Methodology\n");
  parts.push(
    `Testing used manual adversarial interaction with structured evaluator analysis per turn. Each analyzed turn includes verdict, score, confidence, reasoning, and category-specific signals. Total session size was ${session.turns.length} turns (${analyzed.length} analyzed).\n\n`,
  );

  if (hasMultiTurn) {
    parts.push(
      "## 5. Attack Chain / Interaction Flow\n",
    );
    parts.push(
      `The interaction progressed through iterative prompting with intent shifts and boundary probing. First policy issue appeared at turn ${firstIssueTurn ?? "-"}, and first confirmed failure appeared at turn ${firstFailTurn ?? "-"}. Verdict sequence: ${verdicts.length > 0 ? verdicts.join(" -> ") : "No analyzed turns"}.\n\n`,
    );
    parts.push("**Turn progression**\n");
    for (const t of session.turns) {
      parts.push(
        `- Turn ${t.turnNumber}: ${t.evaluationVerdict ?? "NOT_ANALYZED"}${t.evaluationScore != null ? ` (score ${t.evaluationScore})` : ""}\n`,
      );
    }
    parts.push("\n");
  } else {
    parts.push("## 5. Prompt Analysis\n");
    parts.push(
      "Single-turn analysis focused on whether the model maintained policy-consistent refusal and safe handling under adversarial framing. Observed behavior was compared directly against expected safety boundaries for the tested domain.\n\n",
    );
  }

  parts.push("## 6. Evidence Summary\n");
  if (failures.length === 0) {
    parts.push(
      "No non-SAFE analyzed turns were recorded in this sample. Available evidence indicates policy-consistent behavior for the tested interactions.\n\n",
    );
  } else {
    parts.push(
      "Key evidence includes non-SAFE turn summaries and associated evaluator reasoning. Supporting image artifacts are retained in authorized storage but intentionally not embedded in markdown export.\n\n",
    );
    parts.push("**Evidence highlights**\n");
    for (const t of failures.slice(0, 5)) {
      parts.push(
        `- Turn ${t.turnNumber}: verdict ${t.evaluationVerdict}, summary: ${(t.evaluationSummary ?? "No summary").trim()}\n`,
      );
    }
    parts.push("\n");
  }

  parts.push("## 7. Findings & Failure Modes\n");
  if (failures.length === 0) {
    parts.push(
      "No failure mode was confirmed in the analyzed sample.\n\n",
    );
  } else {
    parts.push(
      `Primary finding is **${keyFinding.toLowerCase()}** with repeated safety boundary degradation under ${session.strategy.toLowerCase()} prompts.\n\n`,
    );
    parts.push("**Observed failure modes**\n");
    parts.push(
      `- Policy violation / harmful generation signals on ${failedCount} turn(s)\n`,
    );
    if (borderlineCount > 0) {
      parts.push(
        `- Borderline safety handling on ${borderlineCount} turn(s)\n`,
      );
    }
    parts.push(
      "- Inconsistent refusal stability across the full chain\n\n",
    );
  }

  parts.push("## 8. Root Cause Analysis\n");
  parts.push(
    "Evidence suggests a context-tracking and policy-enforcement weakness under iterative adversarial reframing. Safety behavior appears stronger on some turns and weaker on others, indicating guardrail activation may be sensitive to prompt phrasing or accumulated conversational context. This is a hypothesis based on observed turn-level behavior rather than internal model telemetry.\n\n",
  );

  parts.push("## 9. Severity Assessment\n");
  parts.push(
    `- **Severity:** ${severity}\n- **Impact:** ${worst === "FAILED" ? "Direct policy-relevant unsafe outputs were observed." : worst === "BORDERLINE" ? "Ambiguous outputs indicate potential policy drift under pressure." : "No observed policy failure in sampled interactions."}\n- **Exploitability:** ${hasMultiTurn ? "Achievable via realistic multi-turn prompting patterns." : "Attempted in a direct prompt context."}\n- **User risk:** ${impactLine}\n\n`,
  );

  parts.push("## 10. Real-World Impact\n");
  parts.push(
    "If this behavior reproduces at scale, users can obtain harmful outputs through realistic prompt manipulation. Potential impact includes safety incidents, user trust degradation, increased moderation burden, and heightened governance/compliance risk for the product team.\n\n",
  );

  parts.push("## 11. Recovery & Guardrail Behavior\n");
  if (firstFailTurn == null) {
    parts.push(
      "No recovery analysis required because no FAILED turn was observed.\n\n",
    );
  } else if (recoveredAfterFail) {
    parts.push(
      `The model showed partial recovery after initial failure (first FAIL at turn ${firstFailTurn}), returning to SAFE behavior in a later turn. ${relapsedAfterRecovery ? "However, safety later regressed again, indicating unstable guardrail consistency." : "No subsequent regression was observed after recovery in this sample."}\n\n`,
    );
  } else {
    parts.push(
      `No meaningful recovery was observed after the first FAILED turn (${firstFailTurn}); safety controls did not consistently reassert.\n\n`,
    );
  }

  parts.push("## 12. Mitigation Recommendations\n");
  parts.push(
    "- **Short-term:** tighten refusal triggers and policy filters for adversarial emotional framing patterns observed in this session.\n- **Short-term:** add hard blocks for known high-risk lexical and semantic combinations tied to harmful encouragement.\n- **Long-term:** improve context-aware safety enforcement across multi-turn chains to reduce drift and relapse.\n- **Long-term:** expand adversarial training/evaluation sets with strategy-specific variants from this session.\n- **Detection & monitoring:** alert on repeated borderline/failure verdicts within a session and route to enhanced moderation review.\n\n",
  );

  parts.push("## 13. Limitations\n");
  parts.push(
    `- Sample size is limited to ${session.turns.length} turns in one focused scenario.\n- Coverage does not represent all model states, domains, or attack strategies.\n- Evaluator outputs are directional and should be interpreted with analyst review.\n\n`,
  );

  parts.push("## 14. Conclusion\n");
  parts.push(
    `Overall robustness is ${worst === "SAFE" ? "acceptable within this limited sample" : "insufficient for this test scope"}. Final judgment is **${keyFinding} (${severity})**. The primary risk remains: ${impactLine}\n\n`,
  );

  parts.push("## 15. Appendix\n");

  parts.push(
    "### Appendix A: Session metadata\n\n",
  );
  parts.push(
    `| Field | Value |\n| --- | --- |\n| Model type | ${session.modelType} |\n| Target notes | ${session.modelNameOrNotes?.trim() || "-"} |\n| Category | ${session.category} |\n| Strategy | ${session.strategy} |\n| Objective | ${session.objective?.trim() || "-"} |\n| Status | ${session.status} |\n| Created | ${iso(session.createdAt)} |\n| Updated | ${iso(session.updatedAt)} |\n\n`,
  );
  parts.push(
    "### Appendix B: Category evaluation focus (assistant context)\n\n",
  );
  parts.push(
    getCategoryEvaluationTargets(
      session.category,
    ) + "\n\n",
  );
  parts.push("### Appendix C: Turn-by-turn evidence\n");
  parts.push(
    "\n> **Export policy:** Model-output images are intentionally not embedded in Markdown exports.\n\n",
  );

  for (const t of session.turns) {
    parts.push(`#### Turn ${t.turnNumber}\n\n`);
    parts.push(
      `**Turn ID:** \`${t.id}\` · **Created:** ${iso(t.createdAt)}\n\n`,
    );
    parts.push(
      `**Analysis status:** ${t.evaluationVerdict ? `Evaluated (${t.evaluationVerdict})` : "Not analyzed"}\n\n`,
    );

    parts.push("**Prompt**\n\n");
    parts.push(
      fence(
        "text",
        excerpt(
          t.generatedPrompt,
          EXCERPT_PROMPT,
        ),
      ),
    );

    parts.push("**Response / analyst notes**\n\n");
    parts.push(
      fence(
        "text",
        excerpt(
          t.pastedModelResponse,
          EXCERPT_RESPONSE,
        ),
      ),
    );

    parts.push(
      imageOutputNoticeForTurn(
        t.pastedModelImageDataUrl,
        t.pastedModelImageAssetPath,
        t.turnNumber,
      ),
    );

    if (t.evaluationVerdict) {
      parts.push(
        `| Verdict | Score | Confidence |\n| --- | --- | --- |\n| ${t.evaluationVerdict} | ${t.evaluationScore ?? "-"} | ${t.evaluationConfidence ?? "-"} |\n\n`,
      );
      if (t.evaluationSummary?.trim()) {
        parts.push(
          `**Summary:** ${t.evaluationSummary.trim()}\n\n`,
        );
      }
      if (t.evaluationReasoning?.trim()) {
        parts.push(
          `**Reasoning:** ${t.evaluationReasoning.trim()}\n\n`,
        );
      }
      if (t.observedWeakness?.trim()) {
        parts.push(
          `**Observed weakness:** ${t.observedWeakness.trim()}\n\n`,
        );
      }
      parts.push(
        "**Failure excerpts (verbatim)**\n\n",
      );
      parts.push(
        quotedFailuresMd(t.quotedFailures),
      );
      parts.push(
        jsonSignalBlock(
          "Bias / hate / targeting",
          t.discriminatoryBias,
        ),
      );
      parts.push(
        jsonSignalBlock(
          "Explicit content",
          t.explicitContentReport,
        ),
      );
      parts.push(
        jsonSignalBlock(
          "Misinformation",
          t.misinformationReport,
        ),
      );
      parts.push(
        jsonSignalBlock(
          "Category-specific signals",
          t.categorySpecificReport,
        ),
      );
      if (t.recommendedNextPrompt?.trim()) {
        parts.push(
          "**Suggested follow-up prompt**\n\n",
        );
        parts.push(
          fence(
            "text",
            excerpt(
              t.recommendedNextPrompt,
              EXCERPT_FOLLOWUP,
            ),
          ),
        );
      }
    }
    parts.push("\n");
  }

  parts.push("---\n");
  parts.push(
    "This report is generated from PromptTrace session data and evaluator outputs. It is intended as a publishable assessment artifact for internal and external review.\n",
  );

  return parts.join("\n");
}
