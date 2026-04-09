import cors from "cors";
import express from "express";
import { prisma } from "./db.js";
import { prismaErrorMessage } from "./errors.js";
import sessionsRouter from "./routes/sessions.js";

const app = express();
const port = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json({ limit: "40mb" }));

app.get("/api/health", async (_req, res) => {
  const llmMode = process.env.OPENAI_API_KEY?.trim() ? "live" : "mock";
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: "connected", llmMode });
  } catch (e) {
    console.error("Database health check failed:", e);
    res.status(503).json({
      ok: false,
      db: "disconnected",
      llmMode,
      error:
        prismaErrorMessage(e) ??
        "Database unavailable. Fix DATABASE_URL and ensure PostgreSQL is running.",
    });
  }
});

app.use("/api/sessions", sessionsRouter);

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);
    const hint = prismaErrorMessage(err);
    if (hint) {
      return res.status(503).json({
        error: hint,
        details: err instanceof Error ? err.message : err,
      });
    }
    res.status(500).json({
      error: "Internal server error",
      details: err instanceof Error ? err.message : err,
    });
  },
);

app.listen(port, () => {
  console.log(`PromptTrace API http://127.0.0.1:${port}`);
});
