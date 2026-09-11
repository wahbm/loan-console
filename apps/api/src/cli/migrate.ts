import { migrate } from "drizzle-orm/mysql2/migrator";
import { createDatabase } from "../db/client.js";
import { loadConfig } from "../config.js";

const config = loadConfig();
if (config.databaseMode !== "mysql") {
  console.log("DATABASE_MODE=memory，跳过 MariaDB migration");
} else {
  const database = createDatabase(config.databaseUrl);
  await migrate(database.db, { migrationsFolder: "drizzle/migrations" });
  await database.pool.end();
  console.log("MariaDB migration 完成");
}
