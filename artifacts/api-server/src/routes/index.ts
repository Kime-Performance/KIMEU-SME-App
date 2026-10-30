import { Router, type IRouter } from "express";
import healthRouter from "./health";
import kimeuRouter from "./kimeu";
import courseTrackingRouter from "./course-tracking";
import onboardingAdminRouter from "./onboarding-admin";
import fellowshipReviewsRouter from "./fellowship-reviews";
import foundationsAssessmentRouter from "./foundations-assessment";

const router: IRouter = Router();

router.use(healthRouter);
router.use(kimeuRouter);
router.use(courseTrackingRouter);
router.use(onboardingAdminRouter);
router.use(fellowshipReviewsRouter);
router.use(foundationsAssessmentRouter);

export default router;
