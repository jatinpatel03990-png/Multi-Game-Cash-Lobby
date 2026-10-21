import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type Wallet = {
  depositBalance: number;
  winningBalance: number;
  bonusBalance: number;
};

export type PlayerRecord = {
  id: string;
  email: string;
  displayName: string;
  role: "player" | "admin";
  passwordHash: string;
  salt: string;
  wallet: Wallet;
};

export type SessionRecord = {
  tokenHash: string;
  userId: string;
  expiresAt: string;
};

export type TransactionRecord = {
  id: string;
  userId: string;
  userName: string;
  type: "deposit" | "withdrawal";
  status: "pending" | "approved" | "rejected" | "completed";
  amount: number;
  utr: string | null;
  upiId: string | null;
  screenshotDataUrl: string | null;
  tax: number;
  payout: number;
  createdAt: string;
};

export type MatchRecord = {
  id: string;
  userId: string;
  gameId: string;
  gameName: string;
  status: "active" | "won" | "lost";
  entryFee: number;
  prize: number;
  opponentName: string;
  createdAt: string;
};

export type CashStore = {
  users: PlayerRecord[];
  sessions: SessionRecord[];
  transactions: TransactionRecord[];
  matches: MatchRecord[];
  totalGameRake: number;
  totalWithdrawalTaxes: number;
};

const filePath =
  process.env.CASH_GAME_DATA_FILE ??
  path.join(process.cwd(), ".data", "cash-game-store.json");
let writeQueue: Promise<unknown> = Promise.resolve();

function emptyStore(): CashStore {
  return {
    users: [],
    sessions: [],
    transactions: [],
    matches: [],
    totalGameRake: 0,
    totalWithdrawalTaxes: 0,
  };
}

export async function readCashStore(): Promise<CashStore> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("users" in parsed) ||
      !Array.isArray(parsed.users) ||
      !("sessions" in parsed) ||
      !Array.isArray(parsed.sessions) ||
      !("transactions" in parsed) ||
      !Array.isArray(parsed.transactions) ||
      !("matches" in parsed) ||
      !Array.isArray(parsed.matches)
    ) {
      throw new Error("Cash game data file has an invalid structure.");
    }
    return { ...emptyStore(), ...(parsed as Partial<CashStore>) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    return emptyStore();
  }
}

async function writeCashStore(store: CashStore): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(store, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, filePath);
}

export function updateCashStore<T>(
  update: (store: CashStore) => T | Promise<T>,
): Promise<T> {
  const operation = writeQueue.then(async () => {
    const store = await readCashStore();
    const result = await update(store);
    await writeCashStore(store);
    return result;
  });
  writeQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}
