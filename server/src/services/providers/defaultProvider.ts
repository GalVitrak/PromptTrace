import type {
  AnalysisOutput,
  PromptGenerationOutput,
  ProviderConfig,
} from "@prompttrace/shared";
import {
  analyzePastedResponse as analyzeViaLegacy,
  generateAdversarialPrompt as generateViaLegacy,
  resuggestRecommendedNextPrompt as resuggestViaLegacy,
} from "../llm.js";
import type {
  AnalyzeInput,
  ChatMessage,
  GeneratePromptInput,
  LlmProvider,
  ProviderModelInfo,
  ResuggestNextInput,
} from "./types.js";

function fallbackChatReply(
  messages: ChatMessage[],
): string {
  const userMsg =
    [...messages]
      .reverse()
      .find((m) => m.role === "user")
      ?.content.trim() ?? "";
  return `Default provider chat bridge is active (llm.ts-backed). Latest user message:\n\n${userMsg || "(none)"}`;
}

function resolveLegacyBaseUrl(
  provider: ProviderConfig,
): string {
  const normalizeBase = (urlText: string): string => {
    try {
      const u = new URL(urlText);
      return u.toString().replace(/\/+$/, "");
    } catch {
      return urlText.replace(/\/+$/, "");
    }
  };
  return normalizeBase(
    provider.baseUrl?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    "https://api.openai.com/v1",
  );
}

function resolveLegacyModel(
  provider: ProviderConfig,
): string {
  return (
    provider.model?.trim() ||
    process.env.LLM_MODEL?.trim() ||
    "gpt-4o-mini"
  );
}

async function withScopedLlmEnv<T>(
  provider: ProviderConfig,
  run: () => Promise<T>,
): Promise<T> {
  const prevBase = process.env.OPENAI_BASE_URL;
  const prevModel = process.env.LLM_MODEL;
  process.env.OPENAI_BASE_URL = resolveLegacyBaseUrl(provider);
  process.env.LLM_MODEL = resolveLegacyModel(provider);
  try {
    return await run();
  } finally {
    if (prevBase === undefined) {
      delete process.env.OPENAI_BASE_URL;
    } else {
      process.env.OPENAI_BASE_URL = prevBase;
    }
    if (prevModel === undefined) {
      delete process.env.LLM_MODEL;
    } else {
      process.env.LLM_MODEL = prevModel;
    }
  }
}

async function chatViaLegacy(
  provider: ProviderConfig,
  messages: ChatMessage[],
): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return fallbackChatReply(messages);
  const base = resolveLegacyBaseUrl(provider);
  const requestedModel = resolveLegacyModel(provider);
  const fallbackModel =
    process.env.LLM_MODEL?.trim() || "gpt-4o-mini";
  const modelCandidates = Array.from(
    new Set([requestedModel, fallbackModel]),
  );
  let lastError = "Unknown error";
  for (const model of modelCandidates) {
    const res = await fetch(
      `${base}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: provider.temperature ?? 0.4,
          messages,
        }),
      },
    );
    const text = await res.text();
    if (!res.ok) {
      lastError = text || `HTTP ${res.status}`;
      // Retry once with fallback model when the requested model is unavailable.
      if (
        /model_not_found|does not exist|not access/i.test(
          text,
        ) &&
        model !== fallbackModel
      ) {
        continue;
      }
      throw new Error(
        `Legacy provider request failed (${res.status}): ${lastError}`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        "Legacy provider returned invalid JSON.",
      );
    }
    const content = (
      parsed as {
        choices?: Array<{
          message?: { content?: string };
        }>;
      }
    ).choices?.[0]?.message?.content;
    if (!content || !content.trim()) {
      throw new Error(
        "Legacy provider returned empty content.",
      );
    }
    return content.trim();
  }
  throw new Error(
    `Legacy provider request failed: ${lastError}`,
  );
}

async function listDefaultModels(
  provider: ProviderConfig,
): Promise<ProviderModelInfo[]> {
  const hasKey = !!process.env.OPENAI_API_KEY?.trim();
  if (!hasKey) {
    return [
      {
        id: "legacy-llm-ts",
        displayName:
          "Legacy llm.ts adapter (mock mode)",
      },
    ];
  }
  return [
    {
      id: resolveLegacyModel(provider),
      displayName: `OpenAI-compatible (${resolveLegacyModel(provider)})`,
    },
  ];
}

async function testDefaultConnection(
  provider: ProviderConfig,
): Promise<{ ok: boolean; message: string }> {
  const hasKey = !!process.env.OPENAI_API_KEY?.trim();
  if (!hasKey) {
    return {
      ok: true,
      message:
        "Default provider in mock/offline mode (OPENAI_API_KEY not set).",
    };
  }
  const base = resolveLegacyBaseUrl(provider);
  try {
    const ping = await fetch(`${base}/models`, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY?.trim()}`,
      },
    });
    if (!ping.ok) {
      return {
        ok: false,
        message: `OPENAI_API_KEY detected but provider check failed (${ping.status}).`,
      };
    }
    return {
      ok: true,
      message:
        "Default provider ready (OpenAI-compatible endpoint reachable).",
    };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error
          ? e.message
          : "Default provider connectivity check failed.",
    };
  }
}

export const defaultProvider: LlmProvider = {
  async generateAdversarialPrompt(
    input: GeneratePromptInput,
    provider?: ProviderConfig,
  ): Promise<PromptGenerationOutput> {
    return withScopedLlmEnv(
      provider ?? { providerType: "default" },
      () => generateViaLegacy(input),
    );
  },
  async analyzePastedResponse(
    input: AnalyzeInput,
    provider?: ProviderConfig,
  ): Promise<AnalysisOutput> {
    return withScopedLlmEnv(
      provider ?? { providerType: "default" },
      () => analyzeViaLegacy(input),
    );
  },
  async resuggestRecommendedNextPrompt(
    input: ResuggestNextInput,
    provider?: ProviderConfig,
  ): Promise<{ recommendedNextPrompt: string }> {
    return withScopedLlmEnv(
      provider ?? { providerType: "default" },
      () => resuggestViaLegacy(input),
    );
  },
  async chat({
    messages,
    provider,
  }: {
    messages: ChatMessage[];
    provider: ProviderConfig;
  }): Promise<string> {
    return chatViaLegacy(provider, messages);
  },
  async listModels({
    provider,
  }: {
    provider: ProviderConfig;
  }): Promise<ProviderModelInfo[]> {
    return listDefaultModels(provider);
  },
  async testConnection({
    provider,
  }: {
    provider: ProviderConfig;
  }): Promise<{ ok: boolean; message: string }> {
    return testDefaultConnection(provider);
  },
};
