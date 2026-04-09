/**
 * Demo-only LLM adapter: deterministic stubs, no remote API calls, no evaluator system prompts.
 *
 * **Setup:** `cp server/src/services/llm.example.ts server/src/services/llm.ts`
 * (or keep a private `llm.ts` that is gitignored). The app imports `./llm.js`.
 */
import type {
  AnalysisOutput,
  PromptGenerationOutput,
} from "@prompttrace/shared";

export type GeneratePromptInput = {
  modelType: string;
  modelNameOrNotes?: string | null;
  category: string;
  strategy: string;
  objective?: string | null;
  aggressive?: boolean;
};

export type AnalyzeInput = {
  category: string;
  strategy: string;
  generatedPrompt: string;
  pastedResponse: string;
  objective?: string | null;
  aggressive?: boolean;
  nextPromptInstruction?: string | null;
  pastedImageDataUrl?: string | null;
  modelType?: string | null;
};

export type ResuggestNextInput = {
  category: string;
  strategy: string;
  generatedPrompt: string;
  pastedResponse: string;
  objective?: string | null;
  aggressive?: boolean;
  nextPromptInstruction?: string | null;
  priorVerdict: string;
  evaluationSummary: string;
  priorRecommendedNextPrompt?: string | null;
  hasImageOutput?: boolean;
};

function hashSeed(parts: string[]): number {
  let h = 0;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++)
    h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function mockGenerate(
  input: GeneratePromptInput,
): PromptGenerationOutput {
  const seed = hashSeed([
    input.category,
    input.strategy,
    input.modelType,
    input.objective ?? "",
    String(input.aggressive ?? false),
  ]);
  const tag = input.aggressive
    ? "[demo·aggressive]"
    : "[demo]";
  const objective =
    input.objective?.trim() ||
    `Stub objective (${input.category} · ${input.strategy}).`;
  return {
    objective,
    generatedPrompt: `${tag} Stub test prompt for category "${input.category}" and strategy "${input.strategy}". Model type: ${input.modelType}. Seed ${seed % 10000}.`,
    pressurePoint: `Demo placeholder pressure point (${input.category}).`,
    notes:
      "Replace with a real llm.ts implementation for live generation.",
  };
}

function mockAnalyze(
  input: AnalyzeInput,
): AnalysisOutput {
  const hasImage =
    typeof input.pastedImageDataUrl ===
      "string" &&
    input.pastedImageDataUrl.length > 0;
  if (hasImage) {
    return {
      verdict: "BORDERLINE",
      score: 55,
      confidence: 50,
      reasoning:
        "Demo stub: image attached; no pixel analysis in this example adapter.",
      observedWeakness: "N/A in demo mode.",
      recommendedNextPrompt: `[demo] Stub follow-up for image turn.${input.nextPromptInstruction?.trim() ? ` Note: ${input.nextPromptInstruction.trim()}` : ""}`,
      evaluationSummary:
        "Demo stub summary: image present - wire a vision-capable path in your own llm.ts.",
      quotedFailures: [],
      discriminatoryBias: { detected: false },
      explicitContent: { detected: false },
      misinformation: { detected: false },
      categorySpecific: {
        detected: false,
        summary: "Demo stub.",
        issueTags: [],
        verbatimQuotesFromResponse: [],
      },
    };
  }

  const lower =
    input.pastedResponse.toLowerCase();
  const refusal =
    lower.includes("can't") ||
    lower.includes("cannot") ||
    lower.includes("sorry") ||
    lower.includes("policy");
  const verdict = refusal
    ? ("SAFE" as const)
    : ("BORDERLINE" as const);
  const pasted = input.pastedResponse;
  return {
    verdict,
    score: refusal ? 82 : 48,
    confidence: 55,
    reasoning: refusal
      ? "Demo stub: refusal-like wording detected."
      : "Demo stub: no refusal keywords matched.",
    observedWeakness: refusal
      ? "None in this stub pass."
      : "Stub only - not a safety assessment.",
    recommendedNextPrompt: `[demo] Stub next prompt.${input.nextPromptInstruction?.trim() ? ` ${input.nextPromptInstruction.trim()}` : ""}`,
    evaluationSummary: refusal
      ? "Demo stub: treated as safer handling."
      : "Demo stub: treated as ambiguous - replace llm.ts for real scoring.",
    quotedFailures: refusal
      ? []
      : [
          {
            quote:
              pasted.length > 200
                ? `${pasted.slice(0, 200)}…`
                : pasted,
            explanation:
              "Demo excerpt placeholder.",
          },
        ],
    discriminatoryBias: { detected: false },
    explicitContent: { detected: false },
    misinformation: { detected: false },
    categorySpecific: {
      detected: !refusal,
      summary: `Demo stub for category ${input.category}.`,
      issueTags: refusal ? [] : ["demo_stub"],
      verbatimQuotesFromResponse: refusal
        ? []
        : [
            pasted.length > 100
              ? `${pasted.slice(0, 100)}…`
              : pasted,
          ],
    },
  };
}

function mockResuggestNext(
  input: ResuggestNextInput,
): {
  recommendedNextPrompt: string;
} {
  const seed = hashSeed([
    (
      input.pastedResponse.trim() ||
      input.evaluationSummary
    ).slice(0, 120),
    input.priorVerdict,
    String(input.aggressive ?? false),
    input.nextPromptInstruction ?? "",
    String(input.hasImageOutput ?? false),
  ]);
  const base =
    input.priorRecommendedNextPrompt?.trim() ||
    "Stub follow-up prompt.";
  return {
    recommendedNextPrompt: `[demo] ${base} (variant ${seed % 1000})${input.nextPromptInstruction?.trim() ? ` - ${input.nextPromptInstruction.trim()}` : ""}`,
  };
}

export async function resuggestRecommendedNextPrompt(
  input: ResuggestNextInput,
): Promise<{ recommendedNextPrompt: string }> {
  return mockResuggestNext(input);
}

export async function generateAdversarialPrompt(
  input: GeneratePromptInput,
): Promise<PromptGenerationOutput> {
  return mockGenerate(input);
}

export async function analyzePastedResponse(
  input: AnalyzeInput,
): Promise<AnalysisOutput> {
  return mockAnalyze(input);
}
