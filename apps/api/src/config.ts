import "dotenv/config";

export type AppConfig = {
  nodeEnv: string;
  host: string;
  port: number;
  databaseMode: "memory" | "mysql";
  databaseUrl: string;
  sessionSecret: string;
  sessionIdleTtlSeconds: number;
  sessionMaxTtlSeconds: number;
  webOrigin: string;
  adminDataDir: string;
};

function integerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function loadConfig(): AppConfig {
  const databaseMode = process.env.DATABASE_MODE === "mysql" ? "mysql" : "memory";
  const sessionSecret = process.env.SESSION_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "local-development-secret-change-me");
  if (sessionSecret.length < 16) throw new Error("SESSION_SECRET must be at least 16 characters");
  if (process.env.NODE_ENV === "production" && sessionSecret.includes("change-me")) {
    throw new Error("Production SESSION_SECRET must be replaced");
  }
  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    host: process.env.HOST ?? "127.0.0.1",
    port: integerEnv("PORT", 3000),
    databaseMode,
    databaseUrl: process.env.DATABASE_URL ?? "mysql://loan_console:change-me@127.0.0.1:3306/loan_console",
    sessionSecret,
    sessionIdleTtlSeconds: integerEnv("SESSION_IDLE_TTL_SECONDS", 1800),
    sessionMaxTtlSeconds: integerEnv("SESSION_MAX_TTL_SECONDS", 604800),
    webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    adminDataDir: process.env.ADMIN_DATA_DIR ?? ".local"
  };
}
