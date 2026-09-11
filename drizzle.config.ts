import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./apps/api/src/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "mysql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "mysql://loan_console:change-me@127.0.0.1:3306/loan_console"
  }
});
