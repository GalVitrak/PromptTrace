import type { Router } from "express";
import { Router as createRouter } from "express";
import { ProviderConfigSchema } from "@prompttrace/shared";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  listProviderModels,
  testProviderConnection,
} from "../services/providerRouter.js";

const router: Router = createRouter();

router.post(
  "/models",
  asyncHandler(async (req, res) => {
    const parsed = ProviderConfigSchema.safeParse(
      req.body ?? {},
    );
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid provider config",
        details: parsed.error.flatten(),
      });
    }
    const models = await listProviderModels(
      parsed.data,
    );
    return res.json(models);
  }),
);

router.post(
  "/test",
  asyncHandler(async (req, res) => {
    const parsed = ProviderConfigSchema.safeParse(
      req.body ?? {},
    );
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid provider config",
        details: parsed.error.flatten(),
      });
    }
    const result = await testProviderConnection(
      parsed.data,
    );
    return res.json(result);
  }),
);

export default router;
