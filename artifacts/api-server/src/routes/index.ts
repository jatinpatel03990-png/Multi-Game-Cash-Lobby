import { Router, type IRouter } from "express";
import healthRouter from "./health";
import cashLobbyRouter from "./cashLobby";

const router: IRouter = Router();

router.use(healthRouter);
router.use(cashLobbyRouter);

export default router;
