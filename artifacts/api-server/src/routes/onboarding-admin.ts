import { Router } from "express";
import {
  GetKimeuOnboardingParams, GetKimeuOnboardingResponse, SaveKimeuOnboardingParams, SaveKimeuOnboardingBody, SaveKimeuOnboardingResponse,
  GetKimeuSmeAssignmentsResponse, SaveKimeuSmeAssignmentBody, SaveKimeuSmeAssignmentResponse,
} from "@workspace/api-zod";
import { requireActiveAppUser, requireRole } from "../lib/kimeu/access";
import { getOnboarding, saveOnboarding } from "../lib/kimeu/onboarding";
import { getSmeAssignments, saveSmeAssignment } from "../lib/kimeu/sme-assignments";
import { KimeuError } from "../lib/kimeu/sheets";

const router = Router();
function parse<T>(result: { success: true; data: T } | { success: false }): T {
  if (!result.success) throw new KimeuError("Invalid request. Check the selected staff member, course, week and date.", 400, "INVALID_REQUEST");
  return result.data;
}
router.get("/kimeu/admin/sme-assignments", async (req, res) => {
  const user = await requireActiveAppUser(req); requireRole(user, "Admin");
  res.setHeader("Cache-Control", "no-store");
  res.json(GetKimeuSmeAssignmentsResponse.parse(await getSmeAssignments(user)));
});
router.post("/kimeu/admin/sme-assignments", async (req, res) => {
  const user = await requireActiveAppUser(req); requireRole(user, "Admin");
  const input = parse(SaveKimeuSmeAssignmentBody.safeParse(req.body));
  res.setHeader("Cache-Control", "no-store");
  res.json(SaveKimeuSmeAssignmentResponse.parse(await saveSmeAssignment(user, input)));
});
router.get("/kimeu/onboarding/:courseId", async (req, res) => {
  const user = await requireActiveAppUser(req); requireRole(user, "RD");
  const params = parse(GetKimeuOnboardingParams.safeParse(req.params));
  res.setHeader("Cache-Control", "no-store");
  res.json(GetKimeuOnboardingResponse.parse(await getOnboarding(user, params.courseId)));
});
router.post("/kimeu/onboarding/:courseId", async (req, res) => {
  const user = await requireActiveAppUser(req); requireRole(user, "RD");
  const params = parse(SaveKimeuOnboardingParams.safeParse(req.params));
  const input = parse(SaveKimeuOnboardingBody.safeParse(req.body));
  res.setHeader("Cache-Control", "no-store");
  res.json(SaveKimeuOnboardingResponse.parse(await saveOnboarding(user, params.courseId, input)));
});
export default router;
