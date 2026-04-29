# Implementation Plan (Local LLM + CTF Mode)

1. Add a provider router that selects between the existing `llm.ts` flow and a local Ollama provider without editing `llm.ts`.
2. Extend shared schemas with provider config and CTF run/turn/result shapes.
3. Persist provider choice in existing turn metadata so existing session DB schema remains compatible.
4. Add provider utility endpoints for model listing and connection checks.
5. Add dedicated CTF API routes with file-backed persistence and export support (JSON/MD/CSV).
6. Add UI-level mode separation:
   - Red Team mode (existing sessions)
   - CTF mode (new structured adversarial playground)
7. Add CTF controls for attacker/target/judge model config, strategy presets, candidate generation, turn execution, and result labeling.
