import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Prefer server/.env over inherited shell DATABASE_URL (common source of confusing auth failures).
dotenv.config({
  path: path.resolve(__dirname, "../.env"),
  override: true,
});

export const prisma = new PrismaClient();
