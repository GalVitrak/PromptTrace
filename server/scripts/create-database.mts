/**
 * Connects to the default "postgres" maintenance DB and creates the target
 * database from DATABASE_URL if it is missing.
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: path.resolve(__dirname, "../.env"),
  override: true,
});

const dbUrl = process.env.DATABASE_URL?.trim();
if (!dbUrl) {
  console.error("DATABASE_URL is not set. Copy server/.env.example to server/.env.");
  process.exit(1);
}

function databaseNameFromUrl(url: string): string {
  const noFrag = url.split("#")[0];
  const q = noFrag.indexOf("?");
  const main = q === -1 ? noFrag : noFrag.slice(0, q);
  const slash = main.lastIndexOf("/");
  if (slash === -1 || slash === main.length - 1)
    throw new Error("Could not parse database name from DATABASE_URL");
  return decodeURIComponent(main.slice(slash + 1));
}

function adminConnectionString(url: string): string {
  const name = databaseNameFromUrl(url);
  const noFrag = url.split("#")[0];
  const [beforeQuery, query = ""] = noFrag.includes("?")
    ? (noFrag.split("?") as [string, string])
    : [noFrag, ""];
  const slash = beforeQuery.lastIndexOf("/");
  if (slash === -1) throw new Error("Invalid DATABASE_URL");
  const base = `${beforeQuery.slice(0, slash)}/postgres`;
  return query ? `${base}?${query}` : base;
}

const targetDb = databaseNameFromUrl(dbUrl);
const adminUrl = adminConnectionString(dbUrl);

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

const client = new pg.Client({ connectionString: adminUrl });

try {
  await client.connect();
  await client.query(`CREATE DATABASE ${quoteIdent(targetDb)}`);
  console.log(`Created database "${targetDb}".`);
} catch (e) {
  if (
    e &&
    typeof e === "object" &&
    "code" in e &&
    (e as { code: string }).code === "42P04"
  ) {
    console.log(`Database "${targetDb}" already exists.`);
  } else {
    console.error(e);
    process.exit(1);
  }
} finally {
  await client.end().catch(() => {});
}
