import { Router, type IRouter } from "express";
import healthRouter from "./health";
import kimeuRouter from "./kimeu";

const router: IRouter = Router();

router.use(healthRouter);
router.use(kimeuRouter);

export default router;
