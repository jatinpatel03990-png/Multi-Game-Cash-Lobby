import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type Wallet = { totalMoney: number };

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

export type RoomOptionId = "duo20" | "duo50" | "quad20" | "quad50";
export type RoomRecord = {
  id: string;
  gameId: string;
  gameName: string;
  optionId: RoomOptionId;
  entryFee: number;
  playerCount: number;
  requiredSlots: number;
  prize: number;
  adminKeeps: number;
  status: "waiting" | "active" | "finished";
  players: {
    userId: string;
    displayName: string;
    score: number | null;
  }[];
  winnerId: string | null;
  winnerName: string | null;
  createdAt: string;
};

export type AdminSettings = {
  adminUpiId: string;
  adminQrCodeUrl: string;
};

export type Revenue = {
  rake20Player2: number;
  rake50Player2: number;
  rake20Player4: number;
  rake50Player4: number;
  totalWithdrawalTax: number;
};

export type CashStore = {
  users: PlayerRecord[];
  sessions: SessionRecord[];
  transactions: TransactionRecord[];
  rooms: RoomRecord[];
  settings: AdminSettings;
  revenue: Revenue;
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
    rooms: [],
    settings: {
      adminUpiId: "YOUR_UPI_ID@HERE",
      adminQrCodeUrl: "/images/qr-placeholder.png",
    },
    revenue: {
      rake20Player2: 0,
      rake50Player2: 0,
      rake20Player4: 0,
      rake50Player4: 0,
      totalWithdrawalTax: 0,
    },
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
      !Array.isArray(parsed.transactions)
    ) {
      throw new Error("Cash game data file has an invalid structure.");
    }
    const oldStore = parsed as Record<string, unknown>;
    const defaults = emptyStore();
    const users = (parsed.users as PlayerRecord[]).map((user) => {
      const oldWallet = user.wallet as Wallet & {
        depositBalance?: number;
        winningBalance?: number;
        bonusBalance?: number;
      };
      return {
        ...user,
        wallet: {
          totalMoney:
            typeof oldWallet?.totalMoney === "number"
              ? oldWallet.totalMoney
              : (oldWallet?.depositBalance ?? 0) +
                (oldWallet?.winningBalance ?? 0) +
                (oldWallet?.bonusBalance ?? 0),
        },
      };
    });
    return {
      ...defaults,
      ...(oldStore as Partial<CashStore>),
      users,
      rooms: Array.isArray(oldStore.rooms)
        ? (oldStore.rooms as RoomRecord[])
        : [],
      settings: {
        ...defaults.settings,
        ...(typeof oldStore.settings === "object" && oldStore.settings
          ? (oldStore.settings as Partial<AdminSettings>)
          : {}),
      },
      revenue: {
        ...defaults.revenue,
        ...(typeof oldStore.revenue === "object" && oldStore.revenue
          ? (oldStore.revenue as Partial<Revenue>)
          : {}),
      },
    };
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
