import type { Prisma, TestTurn } from "@prisma/client";

/**
 * `TestTurn` plus optional on-disk image path. Use when the editor’s generated
 * Prisma client lags the schema after `pastedModelImageAssetPath` was added.
 */
export type TestTurnWithImageAsset = TestTurn & {
  pastedModelImageAssetPath?: string | null;
};

export function withImageAsset(turn: TestTurn): TestTurnWithImageAsset {
  return turn as TestTurnWithImageAsset;
}

export type TurnImageLookup = {
  pastedModelImageDataUrl: string | null;
  pastedModelImageAssetPath?: string | null;
};

export type ImagePersistPayload = {
  pastedModelImageDataUrl: string | null;
  pastedModelImageAssetPath: string | null;
};

/** Safe for Prisma `data` when generators disagree on column names. */
export function asTestTurnImageUpdate(
  patch: ImagePersistPayload,
): Prisma.TestTurnUpdateInput {
  return patch as Prisma.TestTurnUpdateInput;
}
