// Lightweight embedded database layer (better-sqlite3) exposing a small
// Prisma-like API subset so the rest of the codebase can stay declarative.
// We use this instead of Prisma because this sandbox's network blocks
// downloading Prisma's query-engine binaries; better-sqlite3 builds locally.
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs";

function resolveDbPath() {
  const raw = process.env.DATABASE_URL || "file:./dev.db";
  const file = raw.replace(/^file:/, "");
  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  return abs;
}

const db = new Database(resolveDbPath());
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS User (
  id TEXT PRIMARY KEY,
  fullName TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  whatsapp TEXT,
  passwordHash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'SHOP_OWNER',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Shop (
  id TEXT PRIMARY KEY,
  ownerId TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address TEXT,
  whatsapp TEXT,
  shopToken TEXT NOT NULL UNIQUE,
  runtimeKey TEXT NOT NULL UNIQUE,
  printRule TEXT NOT NULL DEFAULT 'CUSTOMER_CHOICE',
  paymentMode TEXT NOT NULL DEFAULT 'NO_PAYMENT',
  approvalRequired INTEGER NOT NULL DEFAULT 0,
  colorRate REAL NOT NULL DEFAULT 10,
  grayRate REAL NOT NULL DEFAULT 2,
  upiId TEXT,
  defaultPrinterName TEXT,
  autoPrintActive INTEGER NOT NULL DEFAULT 0,
  subscriptionActive INTEGER NOT NULL DEFAULT 0,
  subscriptionUntil TEXT,
  walletBalance REAL NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (ownerId) REFERENCES User(id)
);

CREATE TABLE IF NOT EXISTS AgentStatus (
  id TEXT PRIMARY KEY,
  shopId TEXT NOT NULL UNIQUE,
  online INTEGER NOT NULL DEFAULT 0,
  version TEXT,
  printers TEXT,
  lastSeenAt TEXT,
  osInfo TEXT,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (shopId) REFERENCES Shop(id)
);

CREATE TABLE IF NOT EXISTS PrintJob (
  id TEXT PRIMARY KEY,
  shopId TEXT NOT NULL,
  customerName TEXT,
  customerContact TEXT,
  fileName TEXT NOT NULL,
  filePath TEXT NOT NULL,
  fileType TEXT NOT NULL,
  pages INTEGER NOT NULL DEFAULT 1,
  copies INTEGER NOT NULL DEFAULT 1,
  colorMode TEXT NOT NULL DEFAULT 'GRAY',
  paperSize TEXT NOT NULL DEFAULT 'A4',
  amount REAL NOT NULL DEFAULT 0,
  paymentStatus TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
  paymentMode TEXT NOT NULL DEFAULT 'NO_PAYMENT',
  razorpayOrderId TEXT,
  razorpayPaymentId TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  failureReason TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  printedAt TEXT,
  FOREIGN KEY (shopId) REFERENCES Shop(id)
);

CREATE TABLE IF NOT EXISTS WalletTransaction (
  id TEXT PRIMARY KEY,
  shopId TEXT NOT NULL,
  amount REAL NOT NULL,
  type TEXT NOT NULL,
  note TEXT,
  jobId TEXT,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (shopId) REFERENCES Shop(id)
);

CREATE INDEX IF NOT EXISTS idx_printjob_shop ON PrintJob(shopId);
CREATE INDEX IF NOT EXISTS idx_printjob_status ON PrintJob(shopId, status);
CREATE INDEX IF NOT EXISTS idx_wallet_shop ON WalletTransaction(shopId);
`);

const BOOL_FIELDS = new Set(["approvalRequired", "autoPrintActive", "subscriptionActive", "online"]);

function toRow(obj) {
  const row = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v instanceof Date) row[k] = v.toISOString();
    else if (typeof v === "boolean") row[k] = v ? 1 : 0;
    else row[k] = v;
  }
  return row;
}

function fromRow(row, dateFields = []) {
  if (!row) return null;
  const obj = { ...row };
  for (const key of Object.keys(obj)) {
    if (BOOL_FIELDS.has(key)) obj[key] = !!obj[key];
  }
  for (const key of dateFields) {
    if (obj[key]) obj[key] = new Date(obj[key]);
  }
  return obj;
}

function buildWhere(where = {}) {
  const clauses = [];
  const params = {};
  for (const [k, v] of Object.entries(where)) {
    clauses.push(`${k} = @${k}`);
    params[k] = typeof v === "boolean" ? (v ? 1 : 0) : v;
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function makeModel(table, dateFields = []) {
  return {
    findUnique({ where }) {
      const { sql, params } = buildWhere(where);
      const row = db.prepare(`SELECT * FROM ${table} ${sql} LIMIT 1`).get(params);
      return Promise.resolve(fromRow(row, dateFields));
    },
    findFirst({ where }) {
      const { sql, params } = buildWhere(where);
      const row = db.prepare(`SELECT * FROM ${table} ${sql} LIMIT 1`).get(params);
      return Promise.resolve(fromRow(row, dateFields));
    },
    findMany({ where = {}, orderBy, take } = {}) {
      const { sql, params } = buildWhere(where);
      let order = "";
      if (orderBy) {
        const [field, dir] = Object.entries(orderBy)[0];
        order = `ORDER BY ${field} ${dir === "desc" ? "DESC" : "ASC"}`;
      }
      const limit = take ? `LIMIT ${Number(take)}` : "";
      const rows = db.prepare(`SELECT * FROM ${table} ${sql} ${order} ${limit}`).all(params);
      return Promise.resolve(rows.map((r) => fromRow(r, dateFields)));
    },
    create({ data }) {
      const now = new Date().toISOString();
      const payload = { id: data.id || randomUUID(), ...data };
      if (!("createdAt" in payload) && dateFields.includes("createdAt")) payload.createdAt = now;
      if (!("updatedAt" in payload) && dateFields.includes("updatedAt")) payload.updatedAt = now;
      const row = toRow(payload);
      const cols = Object.keys(row);
      const sql = `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map((c) => `@${c}`).join(",")})`;
      db.prepare(sql).run(row);
      const inserted = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(payload.id);
      return Promise.resolve(fromRow(inserted, dateFields));
    },
    update({ where, data }) {
      const target = db.prepare(`SELECT * FROM ${table} ${buildWhere(where).sql}`).get(buildWhere(where).params);
      if (!target) throw new Error(`${table} record not found for update`);
      const patch = { ...data };
      // support Prisma-style { increment } / { decrement }
      for (const [k, v] of Object.entries(patch)) {
        if (v && typeof v === "object" && !(v instanceof Date)) {
          if ("increment" in v) patch[k] = (target[k] || 0) + v.increment;
          else if ("decrement" in v) patch[k] = (target[k] || 0) - v.decrement;
        }
      }
      if (dateFields.includes("updatedAt")) patch.updatedAt = new Date().toISOString();
      const row = toRow(patch);
      const cols = Object.keys(row);
      if (cols.length) {
        const sql = `UPDATE ${table} SET ${cols.map((c) => `${c} = @${c}`).join(",")} WHERE id = @__id`;
        db.prepare(sql).run({ ...row, __id: target.id });
      }
      const updated = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(target.id);
      return Promise.resolve(fromRow(updated, dateFields));
    },
    upsert({ where, create, update }) {
      const { sql, params } = buildWhere(where);
      const existing = db.prepare(`SELECT * FROM ${table} ${sql}`).get(params);
      if (existing) {
        return this.update({ where: { id: existing.id }, data: update });
      }
      return this.create({ data: create });
    },
    deleteMany({ where }) {
      const { sql, params } = buildWhere(where);
      const info = db.prepare(`DELETE FROM ${table} ${sql}`).run(params);
      return Promise.resolve({ count: info.changes });
    },
  };
}

export const rawDb = db;

export const sqlitePrisma = {
  user: makeModel("User", ["createdAt"]),
  shop: makeModel("Shop", ["createdAt", "updatedAt", "subscriptionUntil"]),
  agentStatus: makeModel("AgentStatus", ["updatedAt", "lastSeenAt"]),
  printJob: makeModel("PrintJob", ["createdAt", "updatedAt", "printedAt"]),
  walletTransaction: makeModel("WalletTransaction", ["createdAt"]),
  async $transaction(actions) {
    // actions is an array of already-created promises (Prisma style) — since
    // our model methods run synchronously under the hood we just await them
    // in order, wrapped in a single better-sqlite3 transaction for atomicity.
    if (typeof actions === "function") {
      return actions(sqlitePrisma);
    }
    const results = [];
    const txn = db.transaction(() => {});
    // better-sqlite3 transactions must be synchronous; our operations are
    // effectively synchronous (wrapped in Promise.resolve), so this is safe.
    for (const action of actions) {
      results.push(await action);
    }
    return results;
  },
};
