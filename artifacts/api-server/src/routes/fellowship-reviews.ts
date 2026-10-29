import { Router } from "express";
import {
  GetKimeuFellowshipReviewsResponse, SaveKimeuFellowshipReviewBody,
  SaveKimeuFellowshipReviewResponse,
} from "@workspace/api-zod";
import { requireActiveAppUser } from "../lib/kimeu/access";
import { getFellowshipReviews, saveFellowshipReview } from "../lib/kimeu/fellowship-reviews";
import { KimeuError } from "../lib/kimeu/sheets";

const router = Router();
router.get("/kimeu/fellowship-reviews", async (req, res) => {
  const user = await requireActiveAppUser(req);
  res.setHeader("Cache-Control", "no-store");
  res.json(GetKimeuFellowshipReviewsResponse.parse(await getFellowshipReviews(user)));
});
router.post("/kimeu/fellowship-reviews", async (req, res) => {
  const user = await requireActiveAppUser(req);
  const parsed = SaveKimeuFellowshipReviewBody.safeParse(req.body);
  if (!parsed.success) throw new KimeuError("Check the PT, review date, result, score and notes.", 400, "INVALID_REVIEW");
  res.setHeader("Cache-Control", "no-store");
  res.json(SaveKimeuFellowshipReviewResponse.parse(await saveFellowshipReview(user, parsed.data)));
});
export default router;
