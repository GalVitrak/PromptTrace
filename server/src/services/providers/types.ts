import type {
  AnalysisOutput,
  PromptGenerationOutput,
  ProviderConfig,
} from "@prompttrace/shared";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ProviderModelInfo = {
  id: string;
  displayName: string;
};

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

export type LlmProvider = {
  generateAdversarialPrompt: (
    input: GeneratePromptInput,
    provider?: ProviderConfig,
  ) => Promise<PromptGenerationOutput>;
  analyzePastedResponse: (
    input: AnalyzeInput,
    provider?: ProviderConfig,
  ) => Promise<AnalysisOutput>;
  resuggestRecommendedNextPrompt: (
    input: ResuggestNextInput,
    provider?: ProviderConfig,
  ) => Promise<{ recommendedNextPrompt: string }>;
  chat: (args: {
    messages: ChatMessage[];
    provider: ProviderConfig;
  }) => Promise<string>;
  listModels: (args: {
    provider: ProviderConfig;
  }) => Promise<ProviderModelInfo[]>;
  testConnection: (args: {
    provider: ProviderConfig;
  }) => Promise<{ ok: boolean; message: string }>;
};
