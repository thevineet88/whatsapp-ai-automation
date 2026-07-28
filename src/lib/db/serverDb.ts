import { type Db, createDb } from "./client";

let db: Db | null = null;

/**
 * Single lazily-created connection pool for Next.js server components and
 * server actions, mirroring the pattern in the webhook route so it can be
 * built from process.env on first use rather than at module load time.
 */
export function getServerDb(): Db {
  if (db) return db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing required environment variable: DATABASE_URL");
  }

  db = createDb(connectionString);
  return db;
}
