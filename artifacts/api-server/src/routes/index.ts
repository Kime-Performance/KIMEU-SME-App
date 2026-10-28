import { Router, type IRouter } from "express";
import healthRouter from "./health";
import kimeuRouter from "./kimeu";
import courseTrackingRouter from "./course-tracking";

const router: IRouter = Router();

router.use(healthRouter);
router.use(kimeuRouter);
router.use(courseTrackingRouter);

export default router;
