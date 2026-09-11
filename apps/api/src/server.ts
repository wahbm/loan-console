import { createDatabase } from "./db/client.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createRepository } from "./repositories/index.js";

const config = loadConfig();
const database = config.databaseMode === "mysql" ? createDatabase(config.databaseUrl) : undefined;
const repository = createRepository({ mode: config.databaseMode, database: database?.db, dataDir: config.adminDataDir });
const app = createApp(config, repository);

app.listen({ host: config.host, port: config.port }).then(() => {
  app.log.info(`loan console API listening on ${config.host}:${config.port}`);
}).catch((error) => {
  app.log.error(error);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await app.close();
  await database?.pool.end();
  process.exit(0);
});
