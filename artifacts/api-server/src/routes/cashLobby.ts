import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  CompleteWithdrawalParams,
  CompleteWithdrawalResponse,
  CreateDepositBody,
  CreateDepositResponse,
  CreateWithdrawalBody,
  CreateWithdrawalResponse,
  DecideDepositBody,
  DecideDepositParams,
  DecideDepositResponse,
  GetAdminDashboardResponse,
  GetLobbyResponse,
  GetRoomParams,
  GetRoomResponse,
  GetSessionResponse,
  JoinRoomBody,
  JoinRoomResponse,
  LeaveRoomParams,
  LeaveRoomResponse,
  SignInBody,
  SignInResponse,
  SignOutResponse,
  SignUpBody,
  SignUpResponse,
  SubmitRoomScoreBody,
  SubmitRoomScoreParams,
  SubmitRoomScoreResponse,
  UpdateAdminSettingsBody,
  UpdateAdminSettingsResponse,
} from "@workspace/api-zod";
import {
  type AdminSettings,
  type PlayerRecord,
  type RoomOptionId,
  type RoomRecord,
  type TransactionRecord,
  readCashStore,
  updateCashStore,
} from "../lib/cashStore";

const router: IRouter = Router();
const COOKIE_NAME = "cash_lobby_session";
const SESSION_DAYS = 7;
const games = [
  { id: "snake", name: "Snake Sprint", description: "Collect, survive, and score." },
  { id: "clicker", name: "Tap Rush", description: "Fast fingers and a short timer." },
  { id: "tic-tac-toe", name: "Tic-Tac-Toe", description: "A quick strategy classic." },
];
const roomOptions = [
  { id: "duo20", title: "2-Player 1v1 · ₹20", playerCount: 2, entryFee: 20, prize: 32.4, adminKeeps: 7.6 },
  { id: "duo50", title: "2-Player 1v1 · ₹50", playerCount: 2, entryFee: 50, prize: 81, adminKeeps: 19 },
  { id: "quad20", title: "4-Player · ₹20", playerCount: 4, entryFee: 20, prize: 60, adminKeeps: 20 },
  { id: "quad50", title: "4-Player · ₹50", playerCount: 4, entryFee: 50, prize: 150, adminKeeps: 50 },
] as const;
const authAttempts = new Map<string, { count: number; resetAt: number }>();

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function publicPlayer(user: PlayerRecord) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
  };
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  };
}

function applyAuthRateLimit(req: Request, res: Response): boolean {
  const key = req.ip ?? "unknown";
  const now = Date.now();
  const current = authAttempts.get(key);
  if (!current || current.resetAt <= now) {
    authAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  current.count += 1;
  if (current.count > 10) {
    res.status(429).json({ error: "Too many attempts. Try again later." });
    return false;
  }
  return true;
}

async function currentUser(req: Request): Promise<PlayerRecord | undefined> {
  const token = req.cookies?.[COOKIE_NAME];
  if (typeof token !== "string" || token.length < 32) return undefined;
  const hash = tokenHash(token);
  const store = await readCashStore();
  const session = store.sessions.find(
    (item) => item.tokenHash === hash && Date.parse(item.expiresAt) > Date.now(),
  );
  return session ? store.users.find((user) => user.id === session.userId) : undefined;
}

function makeSession(store: Awaited<ReturnType<typeof readCashStore>>, user: PlayerRecord) {
  const token = randomBytes(32).toString("base64url");
  store.sessions = store.sessions.filter(
    (session) => Date.parse(session.expiresAt) > Date.now(),
  );
  store.sessions.push({
    tokenHash: tokenHash(token),
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  });
  return {
    token,
    response: { user: publicPlayer(user), wallet: user.wallet },
  };
}

function requirePlayer(user: PlayerRecord | undefined, res: Response): user is PlayerRecord {
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return false;
  }
  return true;
}

function requireAdmin(user: PlayerRecord | undefined, res: Response): user is PlayerRecord {
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return false;
  }
  return true;
}

function createRoomResponse(room: RoomRecord, userId: string) {
  return {
    id: room.id,
    gameId: room.gameId,
    gameName: room.gameName,
    optionId: room.optionId,
    entryFee: room.entryFee,
    playerCount: room.players.length,
    requiredSlots: room.requiredSlots,
    prize: room.prize,
    status: room.status,
    winnerName: room.winnerName,
    players: room.players.map((player) => ({
      userId: player.userId,
      displayName: player.displayName,
      hasSubmittedScore: player.score !== null,
    })),
    createdAt: room.createdAt,
    userSubmittedScore:
      room.players.find((player) => player.userId === userId)?.score !== null,
  };
}

function publicTransaction(transaction: TransactionRecord) {
  return { ...transaction };
}

function roundMoneyRange(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && Math.round(value * 100) === value * 100;
}

router.get("/auth/session", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!user) {
    res.json(GetSessionResponse.parse({ user: null, wallet: null }));
    return;
  }
  res.json(
    GetSessionResponse.parse({ user: publicPlayer(user), wallet: user.wallet }),
  );
});

router.post("/auth/signup", async (req, res): Promise<void> => {
  if (!applyAuthRateLimit(req, res)) return;
  const parsed = SignUpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email, display name, and password." });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const salt = randomBytes(16).toString("hex");
  const passwordHash = scryptSync(parsed.data.password, salt, 64).toString("hex");
  const result = await updateCashStore((store) => {
    if (store.users.some((user) => user.email === email)) return null;
    const adminEmails = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    const role =
      adminEmails.includes(email) ||
      (process.env.NODE_ENV !== "production" && store.users.length === 0)
        ? "admin"
        : "player";
    const user: PlayerRecord = {
      id: randomUUID(),
      email,
      displayName: parsed.data.displayName.trim(),
      role,
      passwordHash,
      salt,
      wallet: { totalMoney: 10 },
    };
    store.users.push(user);
    return { ...makeSession(store, user) };
  });
  if (!result) {
    res.status(409).json({ error: "An account with this email already exists." });
    return;
  }
  res.cookie(COOKIE_NAME, result.token, sessionCookieOptions());
  res.status(201).json(SignUpResponse.parse(result.response));
});

router.post("/auth/login", async (req, res): Promise<void> => {
  if (!applyAuthRateLimit(req, res)) return;
  const parsed = SignInBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your email and password." });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const result = await updateCashStore((store) => {
    const user = store.users.find((entry) => entry.email === email);
    const actual = scryptSync(
      parsed.data.password,
      user?.salt ?? "invalid-user-dummy-salt",
      64,
    );
    const expected = Buffer.from(user?.passwordHash ?? "0".repeat(128), "hex");
    const valid =
      Boolean(user) &&
      expected.length === actual.length &&
      timingSafeEqual(actual, expected);
    return valid && user ? makeSession(store, user) : null;
  });
  if (!result) {
    res.status(401).json({ error: "Email or password is incorrect." });
    return;
  }
  res.cookie(COOKIE_NAME, result.token, sessionCookieOptions());
  res.json(SignInResponse.parse(result.response));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const token = req.cookies?.[COOKIE_NAME];
  if (typeof token === "string") {
    const hash = tokenHash(token);
    await updateCashStore((store) => {
      store.sessions = store.sessions.filter((session) => session.tokenHash !== hash);
    });
  }
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  res.json(SignOutResponse.parse({ success: true }));
});

router.get("/lobby", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!requirePlayer(user, res)) return;
  const store = await readCashStore();
  const room = store.rooms
    .filter((item) => item.players.some((player) => player.userId === user.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  res.json(
    GetLobbyResponse.parse({
      user: publicPlayer(user),
      wallet: user.wallet,
      games,
      roomOptions,
      activeRoom: room ? createRoomResponse(room, user.id) : null,
      transactions: store.transactions
        .filter((item) => item.userId === user.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 10)
        .map(publicTransaction),
      settings: store.settings,
    }),
  );
});

router.post("/rooms/join", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!requirePlayer(user, res)) return;
  const parsed = JoinRoomBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a valid game and room." });
    return;
  }
  const game = games.find((item) => item.id === parsed.data.gameId);
  const option = roomOptions.find((item) => item.id === parsed.data.optionId);
  if (!game || !option) {
    res.status(400).json({ error: "That room is not available." });
    return;
  }
  const result = await updateCashStore((store) => {
    const currentUserRecord = store.users.find((item) => item.id === user.id);
    if (!currentUserRecord) return { kind: "missing-user" as const };
    const existing = store.rooms.find(
      (room) =>
        room.status !== "finished" &&
        room.players.some((player) => player.userId === user.id),
    );
    if (existing) return { kind: "existing" as const, room: existing };
    if (currentUserRecord.wallet.totalMoney < option.entryFee) {
      return { kind: "low-balance" as const };
    }
    let room = store.rooms
      .filter(
        (item) =>
          item.status === "waiting" &&
          item.gameId === game.id &&
          item.optionId === option.id &&
          item.players.length < item.requiredSlots,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    let createdNew = false;
    if (!room) {
      createdNew = true;
      room = {
        id: randomUUID(),
        gameId: game.id,
        gameName: game.name,
        optionId: option.id as RoomOptionId,
        entryFee: option.entryFee,
        playerCount: option.playerCount,
        requiredSlots: option.playerCount,
        prize: option.prize,
        adminKeeps: option.adminKeeps,
        status: "waiting",
        players: [],
        winnerId: null,
        winnerName: null,
        createdAt: new Date().toISOString(),
      };
      store.rooms.push(room);
    }
    currentUserRecord.wallet.totalMoney = roundMoney(
      currentUserRecord.wallet.totalMoney - option.entryFee,
    );
    room.players.push({
      userId: user.id,
      displayName: user.displayName,
      score: null,
    });
    if (room.players.length === room.requiredSlots) room.status = "active";
    return { kind: createdNew ? ("created" as const) : ("joined" as const), room };
  });
  if (result.kind === "missing-user") {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  if (result.kind === "low-balance") {
    res.status(400).json({ error: "Your Total Money balance does not cover this entry fee." });
    return;
  }
  const response = JoinRoomResponse.parse(createRoomResponse(result.room, user.id));
  res.status(result.kind === "created" ? 201 : 200).json(response);
});

router.get("/rooms/:roomId", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!requirePlayer(user, res)) return;
  const params = GetRoomParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid room." });
    return;
  }
  const store = await readCashStore();
  const room = store.rooms.find((item) => item.id === params.data.roomId);
  if (!room || !room.players.some((player) => player.userId === user.id)) {
    res.status(404).json({ error: "Room not found." });
    return;
  }
  res.json(GetRoomResponse.parse(createRoomResponse(room, user.id)));
});

router.post("/rooms/:roomId/leave", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!requirePlayer(user, res)) return;
  const params = LeaveRoomParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid room." });
    return;
  }
  const result = await updateCashStore((store) => {
    const room = store.rooms.find((item) => item.id === params.data.roomId);
    if (!room || !room.players.some((player) => player.userId === user.id)) {
      return "missing" as const;
    }
    if (room.status !== "waiting") return "started" as const;
    const currentUserRecord = store.users.find((item) => item.id === user.id);
    if (currentUserRecord) {
      currentUserRecord.wallet.totalMoney = roundMoney(
        currentUserRecord.wallet.totalMoney + room.entryFee,
      );
    }
    room.players = room.players.filter((player) => player.userId !== user.id);
    if (room.players.length === 0) {
      store.rooms = store.rooms.filter((item) => item.id !== room.id);
    }
    return "ok" as const;
  });
  if (result === "started") {
    res.status(409).json({ error: "This match has already started." });
    return;
  }
  if (result === "missing") {
    res.status(404).json({ error: "Waiting room not found." });
    return;
  }
  res.json(LeaveRoomResponse.parse({ success: true }));
});

router.post("/rooms/:roomId/score", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!requirePlayer(user, res)) return;
  const params = SubmitRoomScoreParams.safeParse(req.params);
  const body = SubmitRoomScoreBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Submit a valid game score." });
    return;
  }
  const result = await updateCashStore((store) => {
    const room = store.rooms.find((item) => item.id === params.data.roomId);
    if (!room || !room.players.some((player) => player.userId === user.id)) {
      return { kind: "missing" as const };
    }
    if (room.status !== "active") return { kind: "not-active" as const };
    const player = room.players.find((item) => item.userId === user.id);
    if (!player) return { kind: "missing" as const };
    if (player.score !== null) return { kind: "already-submitted" as const, room };
    player.score = body.data.score;
    if (room.players.every((item) => item.score !== null)) {
      const winner = [...room.players].sort(
        (a, b) => (b.score ?? 0) - (a.score ?? 0),
      )[0];
      if (!winner) return { kind: "missing" as const };
      room.status = "finished";
      room.winnerId = winner.userId;
      room.winnerName = winner.displayName;
      const winnerRecord = store.users.find((item) => item.id === winner.userId);
      if (winnerRecord) {
        winnerRecord.wallet.totalMoney = roundMoney(
          winnerRecord.wallet.totalMoney + room.prize,
        );
      }
      const revenueKey = ({
        duo20: "rake20Player2",
        duo50: "rake50Player2",
        quad20: "rake20Player4",
        quad50: "rake50Player4",
      } as const)[room.optionId];
      store.revenue[revenueKey] = roundMoney(
        store.revenue[revenueKey] + room.adminKeeps,
      );
    }
    return { kind: "ok" as const, room };
  });
  if (result.kind === "missing") {
    res.status(404).json({ error: "Room not found." });
    return;
  }
  if (result.kind === "not-active") {
    res.status(409).json({ error: "This room has not filled all real-player slots yet." });
    return;
  }
  if (result.kind === "already-submitted") {
    res.status(409).json({ error: "Your score was already submitted." });
    return;
  }
  res.json(
    SubmitRoomScoreResponse.parse(createRoomResponse(result.room, user.id)),
  );
});

router.post("/wallet/deposits", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!requirePlayer(user, res)) return;
  const parsed = CreateDepositBody.safeParse(req.body);
  if (!parsed.success || parsed.data.amount < 50 || parsed.data.amount > 500) {
    res.status(400).json({ error: "Deposits must be between ₹50 and ₹500." });
    return;
  }
  if (!roundMoneyRange(parsed.data.amount)) {
    res.status(400).json({ error: "Enter an amount with up to two decimal places." });
    return;
  }
  const screenshot = parsed.data.screenshotDataUrl;
  if (
    !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(screenshot) ||
    screenshot.length > 2_800_000
  ) {
    res.status(400).json({ error: "Upload a PNG, JPEG, or WebP screenshot under 2 MB." });
    return;
  }
  const transaction = await updateCashStore((store) => {
    if (
      store.transactions.some(
        (item) => item.type === "deposit" && item.utr === parsed.data.utr.trim(),
      )
    ) {
      return null;
    }
    const created: TransactionRecord = {
      id: randomUUID(),
      userId: user.id,
      userName: user.displayName,
      type: "deposit",
      status: "pending",
      amount: roundMoney(parsed.data.amount),
      utr: parsed.data.utr.trim(),
      upiId: null,
      screenshotDataUrl: screenshot,
      tax: 0,
      payout: 0,
      createdAt: new Date().toISOString(),
    };
    store.transactions.push(created);
    return created;
  });
  if (!transaction) {
    res.status(409).json({ error: "That UTR number has already been submitted." });
    return;
  }
  res.status(201).json(CreateDepositResponse.parse(transaction));
});

router.post("/wallet/withdrawals", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!requirePlayer(user, res)) return;
  const parsed = CreateWithdrawalBody.safeParse(req.body);
  if (!parsed.success || parsed.data.amount < 70 || parsed.data.amount > 1000) {
    res.status(400).json({ error: "Withdrawals must be between ₹70 and ₹1,000." });
    return;
  }
  if (!roundMoneyRange(parsed.data.amount)) {
    res.status(400).json({ error: "Enter an amount with up to two decimal places." });
    return;
  }
  const upiId = parsed.data.upiId.trim();
  if (!/^[A-Za-z0-9._-]{2,}@[A-Za-z0-9.-]{2,}$/.test(upiId)) {
    res.status(400).json({ error: "Enter a valid UPI ID." });
    return;
  }
  const transaction = await updateCashStore((store) => {
    const currentUserRecord = store.users.find((item) => item.id === user.id);
    if (!currentUserRecord || currentUserRecord.wallet.totalMoney < parsed.data.amount) {
      return null;
    }
    const tax = roundMoney(parsed.data.amount * 0.05);
    const created: TransactionRecord = {
      id: randomUUID(),
      userId: user.id,
      userName: user.displayName,
      type: "withdrawal",
      status: "pending",
      amount: roundMoney(parsed.data.amount),
      utr: null,
      upiId,
      screenshotDataUrl: null,
      tax,
      payout: roundMoney(parsed.data.amount - tax),
      createdAt: new Date().toISOString(),
    };
    currentUserRecord.wallet.totalMoney = roundMoney(
      currentUserRecord.wallet.totalMoney - created.amount,
    );
    store.transactions.push(created);
    return created;
  });
  if (!transaction) {
    res.status(400).json({ error: "Insufficient Total Money balance." });
    return;
  }
  res.status(201).json(CreateWithdrawalResponse.parse(transaction));
});

router.get("/admin/dashboard", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!requireAdmin(user, res)) return;
  const store = await readCashStore();
  const pending = store.transactions.filter((item) => item.status === "pending");
  res.json(
    GetAdminDashboardResponse.parse({
      ...store.revenue,
      pendingCount: pending.length,
      deposits: pending.filter((item) => item.type === "deposit"),
      withdrawals: pending.filter((item) => item.type === "withdrawal"),
      settings: store.settings,
    }),
  );
});

router.patch("/admin/settings", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!requireAdmin(user, res)) return;
  const parsed = UpdateAdminSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid UPI ID and QR image URL." });
    return;
  }
  const settings = await updateCashStore((store) => {
    store.settings = {
      adminUpiId: parsed.data.adminUpiId.trim(),
      adminQrCodeUrl: parsed.data.adminQrCodeUrl.trim(),
    };
    return store.settings;
  });
  res.json(UpdateAdminSettingsResponse.parse(settings));
});

router.post(
  "/admin/deposits/:transactionId/decision",
  async (req, res): Promise<void> => {
    const user = await currentUser(req);
    if (!requireAdmin(user, res)) return;
    const params = DecideDepositParams.safeParse(req.params);
    const body = DecideDepositBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid deposit decision." });
      return;
    }
    const result = await updateCashStore((store) => {
      const transaction = store.transactions.find(
        (item) =>
          item.id === params.data.transactionId &&
          item.type === "deposit" &&
          item.status === "pending",
      );
      if (!transaction) return null;
      transaction.status =
        body.data.decision === "approve" ? "approved" : "rejected";
      if (transaction.status === "approved") {
        const target = store.users.find((item) => item.id === transaction.userId);
        if (target) {
          target.wallet.totalMoney = roundMoney(
            target.wallet.totalMoney + transaction.amount,
          );
        }
      }
      return transaction;
    });
    if (!result) {
      res.status(404).json({ error: "Pending deposit not found." });
      return;
    }
    res.json(DecideDepositResponse.parse(result));
  },
);

router.post(
  "/admin/withdrawals/:transactionId/complete",
  async (req, res): Promise<void> => {
    const user = await currentUser(req);
    if (!requireAdmin(user, res)) return;
    const params = CompleteWithdrawalParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid withdrawal request." });
      return;
    }
    const result = await updateCashStore((store) => {
      const transaction = store.transactions.find(
        (item) =>
          item.id === params.data.transactionId &&
          item.type === "withdrawal" &&
          item.status === "pending",
      );
      if (!transaction) return null;
      transaction.status = "completed";
      store.revenue.totalWithdrawalTax = roundMoney(
        store.revenue.totalWithdrawalTax + transaction.tax,
      );
      return transaction;
    });
    if (!result) {
      res.status(404).json({ error: "Pending withdrawal not found." });
      return;
    }
    res.json(CompleteWithdrawalResponse.parse(result));
  },
);

export default router;
