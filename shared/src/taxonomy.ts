export const MODEL_TYPES = [
  "Text-to-Text LLM",
  "Text-to-Image",
  "Text-to-Video",
  "Agent / Tool-Using Model",
  "Search-Augmented Assistant",
  "Voice Assistant",
  "Other",
] as const;

export const CATEGORIES = [
  "Adult Sexual Content Policy Evasion",
  "Hate / Harassment Policy Evasion",
  "Misinformation Robustness Testing",
  "Copyright / IP Extraction",
  "Child Safety Boundary Probing",
  "Self-Harm Policy Boundary Probing",
  "Prompt Injection",
  "Privacy / Data Exfiltration Probing",
  "Harmful Instruction Elicitation",
  "General Safety Boundary Testing",
] as const;

export const ATTACK_STRATEGIES = [
  "Direct Request",
  "Indirect Request",
  "Roleplay",
  "Fictional Framing",
  "Academic / Research Framing",
  "Translation / Transformation",
  "Multi-Turn Escalation",
  "Emotional Manipulation",
  "Authority Impersonation",
  "Prompt Injection Style",
  "Ambiguity Exploitation",
  "Refusal Reframing",
] as const;

export type ModelType = (typeof MODEL_TYPES)[number];
export type Category = (typeof CATEGORIES)[number];
export type AttackStrategy = (typeof ATTACK_STRATEGIES)[number];

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
