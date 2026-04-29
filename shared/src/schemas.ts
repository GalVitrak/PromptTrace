import { z } from "zod";
import {
  isAttackStrategy,
  isCategory,
  isCtfResultLabel,
  isCtfStrategyCategory,
  isModelType,
} from "./taxonomy.js";

export const SessionStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const EvaluationVerdictSchema = z.enum(["SAFE", "BORDERLINE", "FAILED"]);
export type EvaluationVerdict = z.infer<typeof EvaluationVerdictSchema>;

export const ProviderTypeSchema = z.enum(["default"]);
export type ProviderType = z.infer<
  typeof ProviderTypeSchema
>;

export const ProviderConfigSchema = z.object({
  providerType: ProviderTypeSchema.default("default"),
  baseUrl: z.string().url().optional(),
  model: z.string().min(1).max(200).optional(),
  systemPrompt: z
    .string()
    .max(20_000)
    .optional(),
  temperature: z.number().min(0).max(2).optional(),
});
export type ProviderConfig = z.infer<
  typeof ProviderConfigSchema
>;

export const PromptGenerationOutputSchema = z.object({
  objective: z.string(),
  generatedPrompt: z.string(),
  pressurePoint: z.string(),
  notes: z.string().optional(),
});
export type PromptGenerationOutput = z.infer<typeof PromptGenerationOutputSchema>;

/** Verbatim excerpt from the tested model output plus why it indicates failure. */
export const QuotedFailureSchema = z.object({
  quote: z.string().max(20_000),
  explanation: z.string().max(8_000),
});
export type QuotedFailure = z.infer<typeof QuotedFailureSchema>;

/** Hate / bias / targeting signal report derived from the pasted model response. */
export const DiscriminatoryBiasReportSchema = z.object({
  detected: z.boolean(),
  summary: z.string().max(12_000).nullable().optional(),
  targetedGroupsOrCommunities: z
    .array(z.string().max(500))
    .max(50)
    .nullable()
    .optional()
    .transform((v) => (Array.isArray(v) ? v : undefined)),
  /** Substrings copied verbatim from pastedModelResponse only. */
  verbatimQuotesFromResponse: z
    .array(z.string().max(20_000))
    .max(30)
    .nullable()
    .optional()
    .transform((v) => (Array.isArray(v) ? v : undefined)),
});
export type DiscriminatoryBiasReport = z.infer<
  typeof DiscriminatoryBiasReportSchema
>;

const verbatimQuotesField = z
  .array(z.string().max(20_000))
  .max(30)
  .nullable()
  .optional()
  .transform((v) => (Array.isArray(v) ? v : undefined));

/** Generic verbatim-backed signal (explicit content, misinformation, etc.). */
export const VerbatimRiskBlockSchema = z.object({
  detected: z.boolean(),
  summary: z.string().max(12_000).nullable().optional(),
  verbatimQuotesFromResponse: verbatimQuotesField,
});
export type VerbatimRiskBlock = z.infer<typeof VerbatimRiskBlockSchema>;

/** Issues aligned to the active session category (see categoryEvaluationTargets). */
export const CategorySpecificReportSchema = z.object({
  detected: z.boolean(),
  summary: z.string().max(12_000).nullable().optional(),
  issueTags: z
    .array(z.string().max(200))
    .max(40)
    .nullable()
    .optional()
    .transform((v) => (Array.isArray(v) ? v : undefined)),
  verbatimQuotesFromResponse: verbatimQuotesField,
});
export type CategorySpecificReport = z.infer<
  typeof CategorySpecificReportSchema
>;

export const AnalysisOutputSchema = z.object({
  verdict: EvaluationVerdictSchema,
  score: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100),
  reasoning: z.string(),
  observedWeakness: z.string(),
  recommendedNextPrompt: z.string(),
  /** Short synthesis after analysis (what happened and why the verdict). */
  evaluationSummary: z.string().max(12_000),
  /** Policy/safety failures with verbatim quotes from the pasted response. */
  quotedFailures: z
    .array(QuotedFailureSchema)
    .max(25)
    .nullable()
    .optional()
    .transform((v) => (Array.isArray(v) ? v : [])),
  discriminatoryBias: DiscriminatoryBiasReportSchema,
  /** Sexual/graphic explicit material or policy-evading explicit narratives. */
  explicitContent: VerbatimRiskBlockSchema,
  /** False claims, fabricated facts, or misleading information presented as true. */
  misinformation: VerbatimRiskBlockSchema,
  /** Failures tied to the session category (targets supplied in categoryEvaluationTargets). */
  categorySpecific: CategorySpecificReportSchema,
});
export type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;

export const BootstrapSessionBodySchema = z.object({
  title: z.string().min(1).max(500).optional(),
  modelType: z.string().refine(isModelType, "Invalid model type"),
  modelNameOrNotes: z.string().max(10_000).optional(),
  category: z.string().refine(isCategory, "Invalid category"),
  strategy: z.string().refine(isAttackStrategy, "Invalid attack strategy"),
  objective: z.string().max(10_000).optional(),
  /** Stronger indirect pressure on policy boundaries (still non-explicit; analyst-controlled). */
  aggressive: z.boolean().optional(),
  provider: ProviderConfigSchema.optional(),
  generateFirstTurn: z.literal(true),
});
export type BootstrapSessionBody = z.infer<typeof BootstrapSessionBodySchema>;

/** Change taxonomy / framing mid-session; affects subsequent analysis LLM context. */
export const UpdateSessionContextBodySchema = z.object({
  category: z.string().refine(isCategory, "Invalid category"),
  strategy: z.string().refine(isAttackStrategy, "Invalid attack strategy"),
  objective: z.union([z.string().max(10_000), z.null()]),
  /** Set ARCHIVED to mark the session concluded (dashboard outcome + final score). */
  status: SessionStatusSchema.optional(),
});
export type UpdateSessionContextBody = z.infer<
  typeof UpdateSessionContextBodySchema
>;

/** Max length for `data:image/...;base64,...` payloads (analyze body). */
export const MAX_PASTED_IMAGE_DATA_URL_CHARS = 15_000_000;

/** Max length for a public `http(s)` image URL pasted by the analyst. */
export const MAX_PASTED_IMAGE_LINK_CHARS = 8192;

const imageDataUrlPrefix =
  /^data:image\/(png|jpeg|jpg|gif|webp);base64,/i;

/** True if value is an allowed inline image data URL or an http(s) image link. */
export function isPastedImageReference(val: string): boolean {
  const t = val.trim();
  if (!t) return false;
  if (imageDataUrlPrefix.test(t))
    return t.length <= MAX_PASTED_IMAGE_DATA_URL_CHARS;
  if (t.length > MAX_PASTED_IMAGE_LINK_CHARS) return false;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export const AnalyzeTurnBodySchema = z
  .object({
    /** Text from the target (or analyst notes when reviewing an image). */
    pastedResponse: z.string().max(500_000).default(""),
    /**
     * Optional image: `data:image/(png|jpeg|jpg|gif|webp);base64,...` or a public
     * `http(s)` URL the evaluator can fetch (e.g. OpenAI vision).
     * Use `null` to clear a previously stored image on re-analyze.
     */
    pastedImageDataUrl: z
      .union([
        z
          .string()
          .min(1)
          .max(
            Math.max(
              MAX_PASTED_IMAGE_DATA_URL_CHARS,
              MAX_PASTED_IMAGE_LINK_CHARS,
            ),
          ),
        z.null(),
      ])
      .optional(),
    /** Request a higher-pressure recommended follow-up prompt (still indirect / non-explicit). */
    aggressive: z.boolean().optional(),
    /** Analyst guidance for how to shape recommendedNextPrompt (e.g. angle, constraints). */
    nextPromptInstruction: z.string().max(4_000).optional(),
    providerOverride: ProviderConfigSchema.optional(),
  })
  .superRefine((val, ctx) => {
    const text = val.pastedResponse.trim();
    const img =
      val.pastedImageDataUrl === undefined
        ? undefined
        : val.pastedImageDataUrl === null
          ? null
          : val.pastedImageDataUrl.trim();
    if (!text && (img === undefined || img === null || img === "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide pasted text (or notes) and/or an image (data URL or https link) for analysis",
      });
    }
    if (typeof img === "string" && img.length > 0 && !isPastedImageReference(img)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pastedImageDataUrl"],
        message:
          "Image must be data:image/png|jpeg|jpg|gif|webp;base64,... or an http(s) URL",
      });
    }
  });
export type AnalyzeTurnBody = z.infer<typeof AnalyzeTurnBodySchema>;

/** Persist analyst edits to the evaluated turn’s recommended follow-up prompt. */
export const UpdateTurnRecommendedPromptBodySchema = z.object({
  recommendedNextPrompt: z.string().min(1).max(500_000),
});
export type UpdateTurnRecommendedPromptBody = z.infer<
  typeof UpdateTurnRecommendedPromptBodySchema
>;

/** Body for POST lock-and-advance (same shape as manual save). */
export const LockAndAdvanceBodySchema = UpdateTurnRecommendedPromptBodySchema;
export type LockAndAdvanceBody = z.infer<typeof LockAndAdvanceBodySchema>;

export const ResuggestNextBodySchema = z.object({
  aggressive: z.boolean().optional(),
  nextPromptInstruction: z.string().max(4_000).optional(),
  providerOverride: ProviderConfigSchema.optional(),
});
export type ResuggestNextBody = z.infer<typeof ResuggestNextBodySchema>;

export const CtfResultLabelSchema = z.enum([
  "SAFE",
  "BORDERLINE",
  "FAILED",
  "PARTIAL_BYPASS",
  "SUCCESSFUL_BYPASS",
  "INCONCLUSIVE",
]);
export type CtfResultLabel = z.infer<
  typeof CtfResultLabelSchema
>;

export const CtfDifficultySchema = z.enum([
  "EASY",
  "MEDIUM",
  "HARD",
  "EXPERT",
]);
export type CtfDifficulty = z.infer<
  typeof CtfDifficultySchema
>;

const CtfStrategyCategorySchema = z
  .string()
  .refine(
    isCtfStrategyCategory,
    "Invalid CTF strategy category",
  );

export const CtfTurnSchema = z.object({
  turnNumber: z.number().int().min(1),
  candidateAttackPrompt: z.string().max(500_000),
  promptSent: z.string().max(500_000),
  targetResponse: z.string().max(1_000_000),
  judgeLabel: CtfResultLabelSchema.optional(),
  analystLabel: CtfResultLabelSchema.optional(),
  notes: z.string().max(20_000).optional(),
  createdAt: z.string(),
});
export type CtfTurn = z.infer<typeof CtfTurnSchema>;

export const CtfRunSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  mode: z.literal("CTF"),
  attackerModel: z.string().min(1).max(200),
  targetModel: z.string().min(1).max(200),
  judgeModel: z.string().max(200).optional(),
  attackerProvider: ProviderConfigSchema.optional(),
  targetProvider: ProviderConfigSchema.optional(),
  judgeProvider: ProviderConfigSchema.optional(),
  strategyCategory: CtfStrategyCategorySchema,
  strategyName: z.string().min(1).max(200),
  challengeObjective: z
    .string()
    .max(2_000)
    .optional(),
  flagFormatHint: z.string().max(500).optional(),
  difficulty: CtfDifficultySchema.default("MEDIUM"),
  guardrailProfile: z
    .string()
    .max(200)
    .optional(),
  systemPromptUsed: z
    .string()
    .max(20_000)
    .optional(),
  transcript: z.array(CtfTurnSchema),
  finalResult: CtfResultLabelSchema.optional(),
  notes: z.string().max(50_000).optional(),
  tags: z.array(z.string().max(80)).max(50),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CtfRun = z.infer<typeof CtfRunSchema>;

export const CreateCtfRunBodySchema = z.object({
  attackerModel: z.string().min(1).max(200),
  targetModel: z.string().min(1).max(200),
  judgeModel: z.string().max(200).optional(),
  attackerProvider: ProviderConfigSchema.optional(),
  targetProvider: ProviderConfigSchema.optional(),
  judgeProvider: ProviderConfigSchema.optional(),
  strategyCategory: CtfStrategyCategorySchema,
  strategyName: z.string().min(1).max(200),
  challengeObjective: z
    .string()
    .max(2_000)
    .optional(),
  flagFormatHint: z.string().max(500).optional(),
  difficulty: CtfDifficultySchema.optional(),
  guardrailProfile: z.string().max(200).optional(),
  systemPromptUsed: z
    .string()
    .max(20_000)
    .optional(),
  notes: z.string().max(50_000).optional(),
  tags: z.array(z.string().max(80)).max(50).optional(),
});
export type CreateCtfRunBody = z.infer<
  typeof CreateCtfRunBodySchema
>;

export const GenerateCtfAttackBodySchema = z.object({
  analystInstruction: z
    .string()
    .max(10_000)
    .optional(),
  vectorOverride: z.string().max(200).optional(),
  providerOverride: ProviderConfigSchema.optional(),
});
export type GenerateCtfAttackBody = z.infer<
  typeof GenerateCtfAttackBodySchema
>;

export const ExecuteCtfTurnBodySchema = z.object({
  prompt: z.string().min(1).max(500_000),
  autoJudge: z.boolean().optional(),
  targetProviderOverride:
    ProviderConfigSchema.optional(),
  judgeProviderOverride:
    ProviderConfigSchema.optional(),
});
export type ExecuteCtfTurnBody = z.infer<
  typeof ExecuteCtfTurnBodySchema
>;

export const AnalyzeCtfResponseBodySchema = z.object({
  prompt: z.string().min(1).max(500_000),
  pastedResponse: z.string().min(1).max(1_000_000),
  ctfInstruction: z.string().max(10_000).optional(),
  vectorOverride: z.string().max(200).optional(),
  autoJudge: z.boolean().optional(),
  judgeProviderOverride:
    ProviderConfigSchema.optional(),
});
export type AnalyzeCtfResponseBody = z.infer<
  typeof AnalyzeCtfResponseBodySchema
>;

export const UpdateCtfRunBodySchema = z.object({
  finalResult: z
    .string()
    .refine(isCtfResultLabel, "Invalid result label")
    .optional(),
  notes: z.string().max(50_000).optional(),
  tags: z.array(z.string().max(80)).max(50).optional(),
});
export type UpdateCtfRunBody = z.infer<
  typeof UpdateCtfRunBodySchema
>;

/** LLM JSON when regenerating only the follow-up prompt. */
export const RecommendedNextOnlySchema = z.object({
  recommendedNextPrompt: z.string().min(1).max(500_000),
});
export type RecommendedNextOnly = z.infer<typeof RecommendedNextOnlySchema>;

export type HeuristicFlags = {
  refusalLikely?: boolean;
  complianceMarkers?: boolean;
  veryShort?: boolean;
  veryLong?: boolean;
  ambiguous?: boolean;
  /** Turn included an image output for review (text-to-image workflows). */
  imageOutputAttached?: boolean;
  /** Snapshot of the assistant’s suggested next prompt after Analyze (for reset). */
  assistantRecommendedNextPrompt?: string;
  /** True after the analyst saved a manual edit via PATCH. */
  analystEditedRecommendedNextPrompt?: boolean;
};
