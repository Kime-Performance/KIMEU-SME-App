import { Router } from "express";
import { GetKimeuFoundationsAssessmentResponse, SaveKimeuFoundationsAssessmentBody, SaveKimeuFoundationsAssessmentResponse } from "@workspace/api-zod";
import { requireActiveAppUser, requireRole } from "../lib/kimeu/access";
import { getFoundationsAssessment, saveFoundationsAssessment } from "../lib/kimeu/foundations-assessment";
import { KimeuError } from "../lib/kimeu/sheets";

const router = Router();
router.get("/kimeu/foundations-assessment", async (req, res): Promise<void> => {
  const user = await requireActiveAppUser(req);
  requireRole(user, "RD");
  res.setHeader("Cache-Control", "no-store");
  res.json(GetKimeuFoundationsAssessmentResponse.parse(await getFoundationsAssessment(user)));
});
router.post("/kimeu/foundations-assessment", async (req, res): Promise<void> => {
  const user = await requireActiveAppUser(req);
  requireRole(user, "RD");
  const parsed = SaveKimeuFoundationsAssessmentBody.safeParse(req.body);
  if (!parsed.success) throw new KimeuError("Select a PT and choose Pass or Fail.", 400, "INVALID_REQUEST");
  res.setHeader("Cache-Control", "no-store");
  res.json(SaveKimeuFoundationsAssessmentResponse.parse(await saveFoundationsAssessment(user, parsed.data)));
});
export default router;
