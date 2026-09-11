import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import * as schema from "./schema.js";

export function createDatabase(url: string) {
  const pool = mysql.createPool(url);
  return { db: drizzle(pool, { schema, mode: "default" }), pool };
}

export type Database = ReturnType<typeof createDatabase>["db"];
