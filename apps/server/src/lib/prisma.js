import { sqlitePrisma } from "./sqlite.js";

// Kept as `prisma` for API-compatibility with the rest of the codebase even
// though it's backed by a small better-sqlite3 shim (see ./sqlite.js).
export const prisma = sqlitePrisma;
