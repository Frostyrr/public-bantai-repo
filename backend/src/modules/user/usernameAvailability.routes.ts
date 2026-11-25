import { Router } from "express";
import { z } from "zod";
import { createServiceClient } from "../../config/supabase";
import AppError from "../../utils/AppError";
import { personalIdentitySchema } from "./personalIdentity";

export function createUsernameAvailabilityRouter(getClient = createServiceClient) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.post("/", async (req, res) => {
      const { username } = z.object({ username: z.string().max(64).pipe(personalIdentitySchema.shape.username) }).strict().parse(req.body);
      const client = getClient();
      if (!client) throw new AppError(503, "Could not check username availability. Try again shortly.");
      const { data, error } = await client.rpc("bantai_username_available", { p_username: username });
      if (error || typeof data !== "boolean") throw new AppError(503, "Could not check username availability. Try again shortly.");
      res.json({ available: data });
    });
  return router;
}
export default createUsernameAvailabilityRouter();
