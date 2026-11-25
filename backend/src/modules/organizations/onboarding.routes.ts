import { Router } from "express";
import { z } from "zod";
import {
  getOrgOnboardingState,
  TOUR_IDS,
  updateOrgOnboardingState,
} from "./onboarding.repository";

const routes = Router();

const updateOnboardingSchema = z
  .object({
    checklistDismissed: z.boolean().optional(),
    markOrgDetailsReviewed: z.boolean().optional(),
    tourUpdate: z
      .object({
        tourId: z.enum(TOUR_IDS),
        version: z.number().int().min(1).max(100),
        status: z.enum(["not_started", "in_progress", "completed", "dismissed"]),
        step: z.number().int().min(0).max(50).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

routes.get("/:organizationId/onboarding", async (req, res, next) => {
  try {
    const auth = req.auth!;
    const organizationId = z.uuid().parse(req.params.organizationId);
    const onboarding = await getOrgOnboardingState(
      auth.accessToken,
      auth.user.id,
      organizationId,
    );
    res.setHeader("Cache-Control", "no-store");
    res.json({ onboarding });
  } catch (err) {
    next(err);
  }
});

routes.patch("/:organizationId/onboarding", async (req, res, next) => {
  try {
    const auth = req.auth!;
    const organizationId = z.uuid().parse(req.params.organizationId);
    const input = updateOnboardingSchema.parse(req.body);
    const onboarding = await updateOrgOnboardingState(
      auth.accessToken,
      auth.user.id,
      organizationId,
      input,
    );
    res.setHeader("Cache-Control", "no-store");
    res.json({ onboarding });
  } catch (err) {
    next(err);
  }
});

export default routes;
