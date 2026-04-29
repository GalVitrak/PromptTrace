# PromptTrace

**Human-in-the-loop black-box adversarial testing workbench** for GenAI safety analysts. Design indirect test prompts, paste target-model responses from external systems, get structured assessments, iterate multi-turn red-team workflows, and export session data for review. Includes a dedicated **CTF mode** for iterative attack loops against opaque targets.

[![Stack](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React_19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)

## Why it exists

Modern LLMs need structured red teaming and robustness evaluation. Analysts often work **black-box**: they copy prompts into a target product, then paste responses back for review. PromptTrace makes that loop **traceable**-session metadata, turn history, evaluation fields, and exports-without pretending to be a source-of-truth safety certification.

## Key features (MVP)

- **Session taxonomy** - Model type, policy category, attack strategy, optional objective.
- **Adversarial test prompt generation** - OpenAI-compatible API with **demo/mock mode** when no API key is set.
- **Response analysis** - Structured verdict (Safe / Borderline / Failed), score, confidence, reasoning, observed weakness, next recommended prompt; combined **LLM + lightweight heuristics**.
- **Iterative turns** - “Create next turn” seeds the next prompt from the prior recommendation.
- **CTF mode** - Objective-driven attack loop for opaque/black-box targets: set a challenge objective, generate an attack prompt, paste the model's response, get a judge label and a suggested follow-up prompt, repeat. Runs are persisted as JSON and fully exportable.
- **Export** - JSON, CSV, and Markdown downloads for both standard sessions and CTF runs.

## Architecture

Monorepo layout:

| Package   | Stack                                                 |
| --------- | ----------------------------------------------------- |
| `shared/` | Taxonomy lists, Zod schemas, shared types             |
| `server/` | Express (TypeScript), Prisma, PostgreSQL, LLM adapter |
| `client/` | React 19, TypeScript, Vite, React Router              |

Development traffic: the Vite dev server proxies `/api` to the Express API (`PORT`, default `3001`).

```text
Browser → Vite :5173 → proxy /api → Express :3001 → Prisma → PostgreSQL
```

### Flow diagrams

**Development stack** - how the UI talks to persistence during `npm run dev`:

```mermaid
flowchart LR
  subgraph client [Browser]
    UI[React workbench]
  end
  subgraph dev [Local dev]
    V[Vite :5173]
    E[Express API :3001]
    Pr[Prisma]
    DB[(PostgreSQL)]
  end
  UI --> V
  V -->|proxy /api| E
  E --> Pr
  Pr --> DB
```

**Analyst workflow** - human-in-the-loop black-box testing (the target system is outside PromptTrace):

```mermaid
flowchart TB
  A[PromptTrace Workflow]
  B[Create session:\nCategory\nStrategy\nModel Type]
  G[Generate adversarial test prompt]
  T[Execute prompt in external target system]
  P[Paste response and optional artifacts]
  N[Analyze: LLM-based evaluation + deterministic heuristics]
  C{Continue iterative testing?}
  L[Lock follow-up and start next turn]
  X[Export Report:\nJSON/CSV/Markdown]

  A --> 
  B --> G
  G --> T
  T --> P
  P --> N
  N --> C
  C -->|Yes| L
  L --> G
  C -->|Conclude Testing| X
```

## CTF mode

CTF mode is a focused attack-loop workflow for analysts who need to probe a **fully opaque target** (a product, API, or hosted model where they cannot inspect system prompts or configure anything). It complements standard sessions by removing the session-level taxonomy overhead and optimizing for rapid iterative prompting.

### How it works

1. **Start a CTF loop** - Give the run a name, pick an attack strategy, and describe the challenge objective (what you are trying to get the target to do or reveal).
2. **Generate an attack prompt** - The LLM attacker generates a candidate prompt tailored to the objective and chosen strategy. You can regenerate as many times as you like and edit the prompt before sending.
3. **Send to your target** - Copy the prompt, execute it in the opaque target system, and paste the response back into PromptTrace.
4. **Analyze** - The analyzer judges the response (SAFE / BORDERLINE / PARTIAL\_BYPASS / SUCCESSFUL\_BYPASS / FAILED / INCONCLUSIVE) and suggests the next attack prompt.
5. **Iterate** - The suggested next prompt is pre-loaded; adjust the strategy or CTF instructions and repeat from step 3.
6. **Export** - Download the full run as JSON, CSV, or a structured Markdown report at any point.

### CTF workflow diagram

```mermaid
flowchart TB
  O[Set objective\n& attack strategy]
  G[Generate attack prompt]
  S[Send prompt to opaque target]
  P[Paste target response]
  J[Analyze: judge label\n+ suggested next prompt]
  C{Bypass achieved?}
  N[Load suggested\nnext prompt]
  X[Export run:\nJSON / CSV / Markdown]

  O --> G
  G --> S
  S --> P
  P --> J
  J --> C
  C -->|No| N
  N --> G
  C -->|Yes or done| X
```

CTF runs are stored as JSON files under `docs/generated_ctf_runs/` and are never written to the PostgreSQL database.

## Prerequisites

- Node.js 20+
- PostgreSQL 16+ (or Docker; see below)

## Quick start

```bash
git clone https://github.com/GalVitrak/PromptTrace
cd PromptTrace
npm install
```

Then follow **Database** → **Environment** → **Migrate** → **Run** below.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Database

**Option A - Docker Compose**

```bash
docker compose up -d
```

Use this connection string in `server/.env`:

```env
DATABASE_URL="postgresql://prompttrace:prompttrace@localhost:5432/prompttrace?schema=public"
```

**Option B - existing PostgreSQL**

Create a database and set `DATABASE_URL` accordingly.

### 3. Environment

Copy [`server/.env.example`](server/.env.example) to `server/.env` and adjust values.

**LLM adapter file:** The repository does **not** include `server/src/services/llm.ts` by design-not by mistake. That file holds the live OpenAI-compatible integration and the full evaluator prompts used for adversarial testing workflows. Keeping it out of version control reduces the risk of shipping those prompts publicly, discourages pointing automated adversarial traffic at provider APIs from a clone, and supports safer defaults for anyone browsing the repo. For **mock and demo usage**, the tree includes [`server/src/services/llm.example.ts`](server/src/services/llm.example.ts) instead: copy it to `llm.ts` locally so TypeScript can resolve the import.

```bash
cp server/src/services/llm.example.ts server/src/services/llm.ts
```

On Windows (PowerShell): `Copy-Item server/src/services/llm.example.ts server/src/services/llm.ts`

- **`OPENAI_API_KEY`** - Optional. If unset or empty, the API runs in **mock/demo mode** (deterministic canned outputs) so the UI remains demoable without external calls.
- **`OPENAI_BASE_URL`** - Optional. Defaults to OpenAI’s API base URL for compatible providers.
- **`LLM_MODEL`** - e.g. `gpt-4o-mini`.
- **`HERETIC_BASE_URL`** - Optional server-side base URL for the Heretic local provider (default `http://localhost:8000`).

If you want the browser Heretic button to target a custom endpoint, create `client/.env.local` with:

```env
VITE_HERETIC_API_URL=http://localhost:8000
```

### Heretic Local server quickstart

PowerShell:

1. Activate env: `.\heretic-env\Scripts\activate`
2. Run server: `uvicorn server:app --host 0.0.0.0 --port 8000`
3. Test endpoint:

```powershell
Invoke-RestMethod -Uri "http://localhost:8000/generate" -Method POST -ContentType "application/json" -Body '{"prompt":"hello"}'
```

### 4. Create the database (first time only)

PostgreSQL must have a database matching the name in `DATABASE_URL` (default: `prompttrace`). From `server/`:

```bash
npm run db:create
```

This connects to the built-in `postgres` database and runs `CREATE DATABASE` for you. If `npm install` failed with a Prisma `EPERM` on Windows, stop running dev servers and retry `npm install`.

### 5. Migrate / push schema

From repository root:

```bash
cd server
npx prisma migrate deploy
```

For local iteration without migration history, you may use:

```bash
npx prisma db push
```

### 6. Run the app

From repository root:

```bash
npm run dev
```

- Client: http://localhost:5173
- API: http://127.0.0.1:3001/api/health

The client calls `/api/...` through the Vite proxy.

### Production builds

```bash
npm run build
```

Run the API with `node server/dist/index.js` (after setting `DATABASE_URL` and running migrations). Serve `client/dist` as static assets or deploy separately.

## API summary

### Sessions

| Method  | Path                                            | Description                                                |
| ------- | ----------------------------------------------- | ---------------------------------------------------------- |
| `GET`   | `/api/health`                                   | Health + `llmMode` (`live` / `mock`)                       |
| `GET`   | `/api/sessions`                                 | List sessions                                              |
| `POST`  | `/api/sessions`                                 | Bootstrap session + first turn (`generateFirstTurn: true`) |
| `GET`   | `/api/sessions/:id`                             | Session with turns                                         |
| `POST`  | `/api/sessions/:id/turns/:turnId/analyze`       | Analyze pasted response                                    |
| `POST`  | `/api/sessions/:id/turns/next`                  | Create next turn from prior recommendation                 |
| `GET`   | `/api/sessions/:id/export?format=json\|csv\|md` | Download export (Markdown excludes image pixels/URLs)      |

### CTF

| Method  | Path                                          | Description                                                    |
| ------- | --------------------------------------------- | -------------------------------------------------------------- |
| `GET`   | `/api/ctf/runs`                               | List all CTF runs                                              |
| `POST`  | `/api/ctf/runs`                               | Create a new CTF run                                           |
| `GET`   | `/api/ctf/runs/:id`                           | Get a single CTF run (with full transcript)                    |
| `POST`  | `/api/ctf/runs/:id/generate-attack`           | Generate a candidate attack prompt for the current turn        |
| `POST`  | `/api/ctf/runs/:id/analyze-response`          | Submit a pasted response; returns judge label + next prompt    |
| `POST`  | `/api/ctf/runs/:id/execute-turn`              | Execute a turn against a live provider target (non-black-box)  |
| `PATCH` | `/api/ctf/runs/:id`                           | Update run metadata (final result, notes, tags)                |
| `GET`   | `/api/ctf/runs/:id/export?format=json\|csv\|md` | Download full run export                                     |

## Repository hygiene (GitHub)

This repo uses [`.gitignore`](.gitignore) to reduce the risk of leaking sensitive material:

- **Live LLM adapter** - `server/src/services/llm.ts` is ignored so evaluator prompts and provider wiring stay local; use tracked `llm.example.ts` as the starting point for demos (see **Setup → Environment**).
- **Secrets** - `.env` files (templates like `.env.example` stay tracked).
- **Prompts & exports** - Local folders such as `prompts/`, `exports/`, and `session-exports/` are ignored so adversarial prompt banks and downloaded session dumps are not pushed by mistake.
- **Markdown reports & session images** - `docs/generated_reports/` (Markdown exports; **no image pixels or URLs** in `.md` for safer sharing) and `assets/<sessionId>/` (canonical image uploads for the app) are ignored by default; only `.gitkeep` placeholders are tracked. Legacy `report_media/` folders may remain locally from older exports.
- **Fine-tuning & training artifacts** - Paths like `fine-tuning/`, `training-data/`, weights (`*.safetensors`, `*.ckpt`, etc.), run trackers (`wandb/`, `mlruns/`), and `*.jsonl` corpora are ignored.

If you need versioned **non-sensitive** JSONL fixtures later, rename them (for example `*.fixture.json`) or narrow the ignore rule.

## Safety notice

PromptTrace is intended for **authorized AI safety testing, red teaming, responsible AI, and research** workflows. Analysts must comply with applicable law, organizational policy, and provider terms. The tool is **not** autonomous ground truth: evaluations are **assistant assessments** and must be reviewed by qualified humans. Do not use PromptTrace to solicit explicit disallowed content; it is framed for **boundary probing, robustness testing, and policy-evasion analysis** using professional, indirect formulations.

## Future improvements

- Session list filters (category, verdict, date) and search
- Richer analytics (verdict distributions, turn comparisons)
- Analyst notes per turn, tags, and session archiving UX
- CTF run list filters and a summary dashboard (bypass rate, turn count)
- Optional auth and multi-user org models
- Automated regression suites tied to exported JSON fixtures

## ⚠️ Usage, responsibility & license

PromptTrace is intended for **authorized AI safety testing, red teaming, and research purposes only**.

By using this tool, you acknowledge and agree that:

- You are solely responsible for how you use this software and any prompts or outputs generated through it.
- You will only use this tool in environments where you are **explicitly authorized** to perform testing.
- You will not use this tool to generate, distribute, or facilitate harmful, illegal, or abusive content.
- You understand that this tool is designed to **evaluate model robustness**, not to bypass safeguards for misuse.

The author assumes **no liability** for misuse of this tool or for any consequences resulting from its use.

**Copyright and license:** This repository does **not** include a separate `LICENSE` file. **All rights reserved** unless and until an explicit license is added here. Without that file, no permissive or open-source license should be inferred from this README alone; use beyond what applicable law allows is not granted by default. Regardless of copyright, **each user remains solely responsible** for their own use, compliance with law and organizational policy, and any prompts or outputs produced with this software.

If you are unsure whether your use case is appropriate, **do not use this tool**.

