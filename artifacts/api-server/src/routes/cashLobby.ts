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
  FinishMatchBody,
  FinishMatchParams,
  FinishMatchResponse,
  GetAdminDashboardResponse,
  GetLobbyResponse,
  GetSessionResponse,
  SignInBody,
  SignInResponse,
  SignOutResponse,
  SignUpBody,
  SignUpResponse,
  StartMatchBody,
  StartMatchResponse,
} from "@workspace/api-zod";
import {
  type CashStore,
  type MatchRecord,
  type PlayerRecord,
  type TransactionRecord,
  readCashStore,
  updateCashStore,
} from "../lib/cashStore";

const router: IRouter = Router();
const COOKIE_NAME = "cash_lobby_session";
const SESSION_DAYS = 7;
const ENTRY_FEE = 60;
const BONUS_ENTRY = 6;
const DEPOSIT_ENTRY = ENTRY_FEE - BONUS_ENTRY;
const WIN_PRIZE = 108;
const PLATFORM_RAKE = 12;
const OPPONENT_NAMES = ["PixelFox", "NeonAce", "QuickByte", "GridRunner"];
const games = [
  {
    id: "snake",
    name: "Snake Sprint",
    description: "Outlast the clock. Collect more than your rival.",
    players: "1v1",
    entryFee: ENTRY_FEE,
    prize: WIN_PRIZE,
  },
  {
    id: "clicker",
    name: "Tap Rush",
    description: "Fast fingers, focused for ten seconds.",
    players: "1v1",
    entryFee: ENTRY_FEE,
    prize: WIN_PRIZE,
  },
  {
    id: "tic-tac-toe",
    name: "Tic-Tac-Toe",
    description: "A quick classic against a simulated rival.",
    players: "1v1",
    entryFee: ENTRY_FEE,
    prize: WIN_PRIZE,
  },
];

const authAttempts = new Map<string, { count: number; resetAt: number }>();

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
  if (typeof token !== "string" || token.length < 32) {
    return undefined;
  }
  const hash = tokenHash(token);
  const store = await readCashStore();
  const session = store.sessions.find(
    (item) => item.tokenHash === hash && Date.parse(item.expiresAt) > Date.now(),
  );
  return session ? store.users.find((user) => user.id === session.userId) : undefined;
}

function cleanTransactions(items: TransactionRecord[]) {
  return items.map((item) => ({ ...item }));
}

function makeSession(store: CashStore, user: PlayerRecord): {
  token: string;
  response: { user: ReturnType<typeof publicPlayer>; wallet: PlayerRecord["wallet"] };
} {
  const token = randomBytes(32).toString("base64url");
  store.sessions = store.sessions.filter(
    (session) => Date.parse(session.expiresAt) > Date.now(),
  );
  store.sessions.push({
    tokenHash: tokenHash(token),
    userId: user.id,
    expiresAt: new Date(
      Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString(),
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

function isWholeRupee(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0;
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
  const password = parsed.data.password;
  const salt = randomBytes(16).toString("hex");
  const passwordHash = scryptSync(password, salt, 64).toString("hex");
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
      wallet: {
        depositBalance: 0,
        winningBalance: 0,
        bonusBalance: 10,
      },
    };
    store.users.push(user);
    return { user, ...makeSession(store, user) };
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
  const found = await updateCashStore((store) => {
    const user = store.users.find((entry) => entry.email === email);
    const salt = user?.salt ?? "invalid-user-dummy-salt";
    const expected = user?.passwordHash ?? "0".repeat(128);
    const actual = scryptSync(parsed.data.password, salt, 64);
    const expectedBuffer = Buffer.from(expected, "hex");
    const valid =
      Boolean(user) &&
      expectedBuffer.length === actual.length &&
      timingSafeEqual(actual, expectedBuffer);
    if (!valid || !user) return null;
    return { ...makeSession(store, user) };
  });
  if (!found) {
    res.status(401).json({ error: "Email or password is incorrect." });
    return;
  }
  res.cookie(COOKIE_NAME, found.token, sessionCookieOptions());
  res.json(SignInResponse.parse(found.response));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const token = req.cookies?.[COOKIE_NAME];
  if (typeof token === "string") {
    const hash = tokenHash(token);
    await updateCashStore((store) => {
      store.sessions = store.sessions.filter(
        (session) => session.tokenHash !== hash,
      );
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
  const response = {
    user: publicPlayer(user),
    wallet: user.wallet,
    games,
    transactions: cleanTransactions(
      store.transactions
        .filter((item) => item.userId === user.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 10),
    ),
    matches: store.matches
      .filter((item) => item.userId === user.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10)
      .map(({ userId: _userId, ...match }) => match),
  };
  res.json(GetLobbyResponse.parse(response));
});

router.post("/matches", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!requirePlayer(user, res)) return;
  const parsed = StartMatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Select a valid game." });
    return;
  }
  const game = games.find((entry) => entry.id === parsed.data.gameId);
  if (!game) {
    res.status(400).json({ error: "That game is not available." });
    return;
  }
  const match = await updateCashStore((store) => {
    const currentUserRecord = store.users.find((entry) => entry.id === user.id);
    if (
      !currentUserRecord ||
      currentUserRecord.wallet.depositBalance < DEPOSIT_ENTRY ||
      currentUserRecord.wallet.bonusBalance < BONUS_ENTRY
    ) {
      return null;
    }
    currentUserRecord.wallet.depositBalance -= DEPOSIT_ENTRY;
    currentUserRecord.wallet.bonusBalance -= BONUS_ENTRY;
    const created: MatchRecord = {
      id: randomUUID(),
      userId: user.id,
      gameId: game.id,
      gameName: game.name,
      status: "active",
      entryFee: ENTRY_FEE,
      prize: WIN_PRIZE,
      opponentName: OPPONENT_NAMES[Math.floor(Math.random() * OPPONENT_NAMES.length)],
      createdAt: new Date().toISOString(),
    };
    store.matches.push(created);
    return created;
  });
  if (!match) {
    res.status(400).json({
      error: "You need at least ₹54 deposit balance and ₹6 bonus balance to enter.",
    });
    return;
  }
  const { userId: _userId, ...response } = match;
  res.status(201).json(StartMatchResponse.parse(response));
});

router.post("/matches/:matchId/finish", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!requirePlayer(user, res)) return;
  const params = FinishMatchParams.safeParse(req.params);
  const body = FinishMatchBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid match result." });
    return;
  }
  const match = await updateCashStore((store) => {
    const current = store.matches.find(
      (item) => item.id === params.data.matchId && item.userId === user.id,
    );
    if (!current) return { kind: "missing" as const };
    if (current.status !== "active") return { kind: "settled" as const };
    current.status = body.data.result;
    store.totalGameRake += PLATFORM_RAKE;
    if (current.status === "won") {
      const currentUserRecord = store.users.find((item) => item.id === user.id);
      if (!currentUserRecord) return { kind: "missing" as const };
      currentUserRecord.wallet.winningBalance += WIN_PRIZE;
    }
    return { kind: "ok" as const, match: current };
  });
  if (match.kind === "missing") {
    res.status(404).json({ error: "Match not found." });
    return;
  }
  if (match.kind === "settled") {
    res.status(409).json({ error: "This match has already been settled." });
    return;
  }
  const { userId: _userId, ...response } = match.match;
  res.json(FinishMatchResponse.parse(response));
});

router.post("/wallet/deposits", async (req, res): Promise<void> => {
  const user = await currentUser(req);
  if (!requirePlayer(user, res)) return;
  const parsed = CreateDepositBody.safeParse(req.body);
  if (!parsed.success || !isWholeRupee(parsed.data?.amount ?? 0)) {
    res.status(400).json({ error: "Enter a whole-rupee amount and valid deposit details." });
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
    const duplicateUtr = store.transactions.some(
      (item) => item.type === "deposit" && item.utr === parsed.data.utr.trim(),
    );
    if (duplicateUtr) return null;
    const created: TransactionRecord = {
      id: randomUUID(),
      userId: user.id,
      userName: user.displayName,
      type: "deposit",
      status: "pending",
      amount: parsed.data.amount,
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
  if (!parsed.success || !isWholeRupee(parsed.data?.amount ?? 0)) {
    res.status(400).json({ error: "Enter a whole-rupee amount and valid UPI ID." });
    return;
  }
  const upiId = parsed.data.upiId.trim();
  if (!/^[A-Za-z0-9._-]{2,}@[A-Za-z0-9.-]{2,}$/.test(upiId)) {
    res.status(400).json({ error: "Enter a valid UPI ID." });
    return;
  }
  const transaction = await updateCashStore((store) => {
    const currentUserRecord = store.users.find((entry) => entry.id === user.id);
    if (
      !currentUserRecord ||
      currentUserRecord.wallet.winningBalance < parsed.data.amount
    ) {
      return null;
    }
    currentUserRecord.wallet.winningBalance -= parsed.data.amount;
    const tax = Math.round(parsed.data.amount * 0.05);
    const created: TransactionRecord = {
      id: randomUUID(),
      userId: user.id,
      userName: user.displayName,
      type: "withdrawal",
      status: "pending",
      amount: parsed.data.amount,
      utr: null,
      upiId,
      screenshotDataUrl: null,
      tax,
      payout: parsed.data.amount - tax,
      createdAt: new Date().toISOString(),
    };
    store.transactions.push(created);
    return created;
  });
  if (!transaction) {
    res.status(400).json({ error: "Insufficient winning balance." });
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
      totalGameRake: store.totalGameRake,
      totalWithdrawalTaxes: store.totalWithdrawalTaxes,
      pendingCount: pending.length,
      deposits: pending.filter((item) => item.type === "deposit"),
      withdrawals: pending.filter((item) => item.type === "withdrawal"),
    }),
  );
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
        if (target) target.wallet.depositBalance += transaction.amount;
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
      store.totalWithdrawalTaxes += transaction.tax;
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
