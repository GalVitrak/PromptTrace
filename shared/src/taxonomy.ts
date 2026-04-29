export const MODEL_TYPES = [
  "Text-to-Text LLM",
  "Text-to-Image",
  "Text-to-Video",
  "Agent / Tool-Using Model",
  "Search-Augmented Assistant",
  "Voice Assistant",
  "Other",
] as const;

/** OWASP Top 10 for LLM Applications 2025 + content-safety harm categories. */
export const CATEGORIES = [
  // ── OWASP LLM Top 10 (2025) ──────────────────────────────────────────────
  "LLM01: Prompt Injection",
  "LLM02: Sensitive Information Disclosure",
  "LLM03: Supply Chain Vulnerabilities",
  "LLM04: Data and Model Poisoning",
  "LLM05: Improper Output Handling",
  "LLM06: Excessive Agency",
  "LLM07: System Prompt Leakage",
  "LLM08: Vector and Embedding Weaknesses",
  "LLM09: Misinformation",
  "LLM10: Unbounded Consumption",
  // ── Content-safety harm categories ───────────────────────────────────────
  "Content Policy: Adult / Sexual Material",
  "Content Policy: Hate & Harassment",
  "Content Policy: Self-Harm",
  "Content Policy: Child Safety",
  "Content Policy: Harmful Instructions",
  "Content Policy: General Safety Boundary",
] as const;

/** OWASP-aligned attack techniques for LLM red-teaming. */
export const ATTACK_STRATEGIES = [
  "Direct Prompt Injection",
  "Indirect Prompt Injection",
  "Jailbreak / Instruction Override",
  "Persona / Role-Play Hijacking",
  "Multi-Turn Trust Escalation",
  "Context Window Poisoning",
  "System Prompt Exfiltration",
  "Tool & Plugin Abuse",
  "Training Data Extraction",
  "Encoding & Obfuscation",
  "Fictional / Academic Framing",
  "Authority Impersonation",
  "Emotional Manipulation",
  "Denial-of-Service Probing",
] as const;

export const MODES = [
  "RED_TEAM",
  "CTF",
] as const;

export const CTF_STRATEGY_CATEGORIES = [
  "Direct Jailbreak",
  "Roleplay / Social Engineering",
  "Prompt Injection",
  "Hidden Instruction Conflict",
  "Multi-Turn Trust Building",
  "Indirect Escalation",
  "Encoding / Obfuscation",
  "Policy Edge Probing",
  "Context Poisoning",
  "Memory / Agent Workflow Manipulation",
] as const;

export const CTF_RESULT_LABELS = [
  "SAFE",
  "BORDERLINE",
  "FAILED",
  "PARTIAL_BYPASS",
  "SUCCESSFUL_BYPASS",
  "INCONCLUSIVE",
] as const;

export type ModelType = (typeof MODEL_TYPES)[number];
export type Category = (typeof CATEGORIES)[number];
export type AttackStrategy = (typeof ATTACK_STRATEGIES)[number];
export type AppMode = (typeof MODES)[number];
export type CtfStrategyCategory =
  (typeof CTF_STRATEGY_CATEGORIES)[number];
export type CtfResultLabelValue =
  (typeof CTF_RESULT_LABELS)[number];

export function isModelType(v: string): v is ModelType {
  return (MODEL_TYPES as readonly string[]).includes(v);
}

/** Sessions where the primary model output to review is often an image. */
export function expectsImageOutputModel(modelType: string): boolean {
  return modelType === "Text-to-Image";
}

export function isCategory(v: string): v is Category {
  return (CATEGORIES as readonly string[]).includes(v);
}

export function isAttackStrategy(v: string): v is AttackStrategy {
  return (ATTACK_STRATEGIES as readonly string[]).includes(v);
}

export function isMode(v: string): v is AppMode {
  return (MODES as readonly string[]).includes(v);
}

export function isCtfStrategyCategory(
  v: string,
): v is CtfStrategyCategory {
  return (
    CTF_STRATEGY_CATEGORIES as readonly string[]
  ).includes(v);
}

export function isCtfResultLabel(
  v: string,
): v is CtfResultLabelValue {
  return (
    CTF_RESULT_LABELS as readonly string[]
  ).includes(v);
}
