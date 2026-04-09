# PromptTrace

**Human-in-the-loop black-box adversarial testing workbench** for GenAI safety analysts. Design indirect test prompts, paste target-model responses from external systems, get structured assessments, iterate multi-turn red-team workflows, and export session data for review.

[![Stack](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React_19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)

## Why it exists

Modern LLMs need structured red teaming and robustness evaluation. Analysts often work **black-box**: they copy prompts into a target product, then paste responses back for review. PromptTrace makes that loop **traceable**—session metadata, turn history, evaluation fields, and exports—without pretending to be a source-of-truth safety certification.

## Key features (MVP)

- **Session taxonomy** — Model type, policy category, attack strategy, optional objective.
- **Adversarial test prompt generation** — OpenAI-compatible API with **demo/mock mode** when no API key is set.
- **Response analysis** — Structured verdict (Safe / Borderline / Failed), score, confidence, reasoning, observed weakness, next recommended prompt; combined **LLM + lightweight heuristics**.
- **Iterative turns** — “Create next turn” seeds the next prompt from the prior recommendation.
- **Export** — JSON and CSV downloads; Markdown reports with session metadata and turn text (model-output images omitted from `.md` for safer handling).

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

**Development stack** — how the UI talks to persistence during `npm run dev`:

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

**Analyst workflow** — human-in-the-loop black-box testing (the target system is outside PromptTrace):

```mermaid
flowchart TB
  A[Create session (Category · Strategy · Model Type)]
  G[Generate adversarial test prompt]
  T[Execute prompt in external target system]
  P[Paste response (and optional artifacts)]
  N[Analyze: LLM-based evaluation + deterministic heuristics]
  C{Continue iterative testing?}
  L[Lock follow-up and start next turn]
  X[Export Report: JSON, CSV, or Markdown]

  A --> G
  G --> T
  T --> P
  P --> N
  N --> C
  C -->|Yes| L
  L --> G
  C -->|Conclude Testing| X
```

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

**Option A — Docker Compose**

```bash
docker compose up -d
```

Use this connection string in `server/.env`:

```env
DATABASE_URL="postgresql://prompttrace:prompttrace@localhost:5432/prompttrace?schema=public"
```

**Option B — existing PostgreSQL**

Create a database and set `DATABASE_URL` accordingly.

### 3. Environment

Copy [`server/.env.example`](server/.env.example) to `server/.env` and adjust values.

- **`OPENAI_API_KEY`** — Optional. If unset or empty, the API runs in **mock/demo mode** (deterministic canned outputs) so the UI remains demoable without external calls.
- **`OPENAI_BASE_URL`** — Optional. Defaults to OpenAI’s API base URL for compatible providers.
- **`LLM_MODEL`** — e.g. `gpt-4o-mini`.

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

| Method | Path                                        | Description                                                |
| ------ | ------------------------------------------- | ---------------------------------------------------------- |
| `GET`  | `/api/health`                               | Health + `llmMode` (`live` / `mock`)                       |
| `GET`  | `/api/sessions`                             | List sessions                                              |
| `POST` | `/api/sessions`                             | Bootstrap session + first turn (`generateFirstTurn: true`) |
| `GET`  | `/api/sessions/:id`                         | Session with turns                                         |
| `POST` | `/api/sessions/:id/turns/:turnId/analyze`   | Analyze pasted response                                    |
| `POST` | `/api/sessions/:id/turns/next`              | Create next turn from prior recommendation                 |
| `GET`  | `/api/sessions/:id/export?format=json\|csv\|md` | Download export (Markdown excludes image pixels/URLs)      |

## Repository hygiene (GitHub)

This repo uses [`.gitignore`](.gitignore) to reduce the risk of leaking sensitive material:

- **Secrets** — `.env` files (templates like `.env.example` stay tracked).
- **Prompts & exports** — Local folders such as `prompts/`, `exports/`, and `session-exports/` are ignored so adversarial prompt banks and downloaded session dumps are not pushed by mistake.
- **Markdown reports & session images** — `docs/generated_reports/` (Markdown exports; **no image pixels or URLs** in `.md` for safer sharing) and `assets/<sessionId>/` (canonical image uploads for the app) are ignored by default; only `.gitkeep` placeholders are tracked. Legacy `report_media/` folders may remain locally from older exports.
- **Fine-tuning & training artifacts** — Paths like `fine-tuning/`, `training-data/`, weights (`*.safetensors`, `*.ckpt`, etc.), run trackers (`wandb/`, `mlruns/`), and `*.jsonl` corpora are ignored.

If you need versioned **non-sensitive** JSONL fixtures later, rename them (for example `*.fixture.json`) or narrow the ignore rule.

## Safety notice

PromptTrace is intended for **authorized AI safety testing, red teaming, responsible AI, and research** workflows. Analysts must comply with applicable law, organizational policy, and provider terms. The tool is **not** autonomous ground truth: evaluations are **assistant assessments** and must be reviewed by qualified humans. Do not use PromptTrace to solicit explicit disallowed content; it is framed for **boundary probing, robustness testing, and policy-evasion analysis** using professional, indirect formulations.

## Future improvements

- Session list filters (category, verdict, date) and search
- Richer analytics (verdict distributions, turn comparisons)
- Analyst notes per turn, tags, and session archiving UX
- Optional auth and multi-user org models
- Automated regression suites tied to exported JSON fixtures

## ⚠️ Usage & Responsibility Notice

PromptTrace is intended for **authorized AI safety testing, red teaming, and research purposes only**.

By using this tool, you acknowledge and agree that:

- You are solely responsible for how you use this software and any prompts or outputs generated through it.
- You will only use this tool in environments where you are **explicitly authorized** to perform testing.
- You will not use this tool to generate, distribute, or facilitate harmful, illegal, or abusive content.
- You understand that this tool is designed to **evaluate model robustness**, not to bypass safeguards for misuse.

The author assumes **no liability** for misuse of this tool or for any consequences resulting from its use.

If you are unsure whether your use case is appropriate, **do not use this tool**.
