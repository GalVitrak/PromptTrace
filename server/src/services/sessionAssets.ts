import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_URL_RE =
  /^data:image\/(png|jpeg|jpg|gif|webp);base64,([\s\S]+)$/i;

const EXT_FOR_SUBTYPE: Record<string, string> = {
  png: "png",
  jpeg: "jpg",
  jpg: "jpg",
  gif: "gif",
  webp: "webp",
};

const CONTENT_TYPE_FOR_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** Repository root (PromptTrace/), resolved from server/src/services. */
export function getRepoRoot(): string {
  return path.resolve(
    fileURLToPath(new URL("../../..", import.meta.url)),
  );
}

export function toPosixPath(p: string): string {
  return p.split(path.sep).join("/");
}

export function resolveAssetAbsolutePath(
  repoRoot: string,
  relPosix: string,
): string | null {
  const norm = relPosix.trim().replace(/\\/g, "/");
  if (!norm.startsWith("assets/")) return null;
  const abs = path.resolve(repoRoot, ...norm.split("/"));
  const assetsRoot = path.resolve(repoRoot, "assets");
  const rel = path.relative(assetsRoot, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return abs;
}

export function parseImageDataUrl(dataUrl: string): {
  buffer: Buffer;
  ext: string;
} | null {
  const m = dataUrl.trim().match(DATA_URL_RE);
  if (!m?.[1] || !m[2]) return null;
  const sub = m[1].toLowerCase();
  const ext = EXT_FOR_SUBTYPE[sub];
  if (!ext) return null;
  let b64 = m[2].replace(/\s/g, "");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  const buffer = Buffer.from(b64, "base64");
  if (buffer.length === 0) return null;
  return { buffer, ext };
}

/** Writes `assets/{sessionId}/{turnId}.{ext}`; returns repo-relative posix path. */
export async function saveTurnImageFromDataUrl(
  repoRoot: string,
  sessionId: string,
  turnId: string,
  dataUrl: string,
): Promise<string | null> {
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) return null;
  const rel = toPosixPath(
    path.join("assets", sessionId, `${turnId}.${parsed.ext}`),
  );
  const abs = path.join(repoRoot, ...rel.split("/"));
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, parsed.buffer);
  return rel;
}

export async function loadImageDataUrlFromAsset(
  repoRoot: string,
  relPosix: string,
): Promise<string | null> {
  const abs = resolveAssetAbsolutePath(repoRoot, relPosix);
  if (!abs) return null;
  const buf = await fs.readFile(abs);
  const ext = path.extname(abs).slice(1).toLowerCase();
  const mime =
    ext === "jpg"
      ? "image/jpeg"
      : ext === "jpeg"
        ? "image/jpeg"
        : `image/${ext}`;
  return `data:${mime};base64,${buf.toString("base64")}`;
}

export async function removeTurnImageAsset(
  repoRoot: string,
  relPosix: string | null | undefined,
): Promise<void> {
  if (!relPosix?.trim()) return;
  const abs = resolveAssetAbsolutePath(repoRoot, relPosix.trim());
  if (!abs) return;
  await fs.unlink(abs).catch(() => {});
}

export function contentTypeForAssetFilename(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPE_FOR_EXT[ext] ?? "application/octet-stream";
}
