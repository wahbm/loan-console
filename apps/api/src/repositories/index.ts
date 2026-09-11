import type { Database } from "../db/client.js";
import { MemoryRepository } from "./memory.js";
import { SqlRepository } from "./sql.js";
import type { Repository } from "./types.js";

export function createRepository(options: { mode: "memory" | "mysql"; database: Database | undefined; dataDir: string }): Repository {
  if (options.mode === "mysql") {
    if (!options.database) throw new Error("MySQL database is not configured");
    return new SqlRepository(options.database);
  }
  return new MemoryRepository(options.dataDir);
}

export * from "./types.js";
