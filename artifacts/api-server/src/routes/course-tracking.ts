import { Router } from "express";
import {
  GetKimeuCourseTrackingParams, GetKimeuCourseTrackingResponse,
  SaveKimeuCourseTrackingParams, SaveKimeuCourseTrackingBody, SaveKimeuCourseTrackingResponse,
} from "@workspace/api-zod";
import { requireActiveAppUser } from "../lib/kimeu/access";
import { getCourseTracking, saveCourseTracking } from "../lib/kimeu/course-tracking";
import { KimeuError } from "../lib/kimeu/sheets";

const router = Router();
router.get("/kimeu/courses/:workshopId/tracking/:sessionDate", async (req, res): Promise<void> => {
  const parsed = GetKimeuCourseTrackingParams.safeParse(req.params);
  if (!parsed.success) throw new KimeuError("Choose a valid workshop date.", 400, "INVALID_REQUEST");
  const user = await requireActiveAppUser(req);
  res.setHeader("Cache-Control", "no-store");
  res.json(GetKimeuCourseTrackingResponse.parse(await getCourseTracking(user, parsed.data.workshopId, parsed.data.sessionDate)));
});
router.post("/kimeu/courses/:workshopId/tracking", async (req, res): Promise<void> => {
  const params = SaveKimeuCourseTrackingParams.safeParse(req.params);
  const body = SaveKimeuCourseTrackingBody.safeParse(req.body);
  if (!params.success || !body.success) throw new KimeuError("Invalid course checklist save.", 400, "INVALID_REQUEST");
  const user = await requireActiveAppUser(req);
  res.setHeader("Cache-Control", "no-store");
  res.json(SaveKimeuCourseTrackingResponse.parse(await saveCourseTracking(user, params.data.workshopId, body.data)));
});
export default router;
