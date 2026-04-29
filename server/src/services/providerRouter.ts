import type { ProviderConfig } from "@prompttrace/shared";
import { ProviderConfigSchema } from "@prompttrace/shared";
import {
  applyAttackVectorToAnalyzeInput,
  applyAttackVectorToGenerateInput,
  applyAttackVectorToResuggestInput,
} from "./attackVectors.js";
import { defaultProvider } from "./providers/defaultProvider.js";
import type {
  AnalyzeInput,
  ChatMessage,
  GeneratePromptInput,
  LlmProvider,
  ProviderModelInfo,
  ResuggestNextInput,
} from "./providers/types.js";

function normalizeProvider(
  provider?: ProviderConfig | null,
): ProviderConfig {
  const parsed = ProviderConfigSchema.safeParse(
    provider ?? {
      providerType: "default",
    },
  );
  if (parsed.success) return parsed.data;
  return { providerType: "default" };
}

function resolveProvider(
  provider?: ProviderConfig | null,
): {
  config: ProviderConfig;
  impl: LlmProvider;
} {
  const config = normalizeProvider(provider);
  return {
    config,
    impl: defaultProvider,
  };
}

export async function generateAdversarialPromptRouted(
  input: GeneratePromptInput,
  provider?: ProviderConfig | null,
) {
  const { impl, config } = resolveProvider(provider);
  return impl.generateAdversarialPrompt(
    applyAttackVectorToGenerateInput(input),
    config,
  );
}

export async function analyzePastedResponseRouted(
  input: AnalyzeInput,
  provider?: ProviderConfig | null,
) {
  const { impl, config } = resolveProvider(provider);
  return impl.analyzePastedResponse(
    applyAttackVectorToAnalyzeInput(input),
    config,
  );
}

export async function resuggestRecommendedNextPromptRouted(
  input: ResuggestNextInput,
  provider?: ProviderConfig | null,
) {
  const { impl, config } = resolveProvider(provider);
  return impl.resuggestRecommendedNextPrompt(
    applyAttackVectorToResuggestInput(input),
    config,
  );
}

export async function providerChat(
  messages: ChatMessage[],
  provider?: ProviderConfig | null,
): Promise<string> {
  const { impl, config } = resolveProvider(provider);
  return impl.chat({ messages, provider: config });
}

export async function listProviderModels(
  provider?: ProviderConfig | null,
): Promise<ProviderModelInfo[]> {
  const { impl, config } = resolveProvider(provider);
  return impl.listModels({ provider: config });
}

export async function testProviderConnection(
  provider?: ProviderConfig | null,
): Promise<{ ok: boolean; message: string }> {
  const { impl, config } = resolveProvider(provider);
  return impl.testConnection({ provider: config });
}
