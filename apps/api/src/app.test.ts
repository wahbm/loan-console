import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { AppConfig } from "./config.js";
import { hashPassword } from "./auth.js";
import { MemoryRepository } from "./repositories/memory.js";

const configs: AppConfig[] = [];
const apps: Array<{ close: () => Promise<void> }> = [];

async function setup() {
  const dataDir = await mkdtemp(join(tmpdir(), "loan-console-test-"));
  const repository = new MemoryRepository(dataDir);
  await repository.createUser({ username: "admin", passwordHash: await hashPassword("password-123456") });
  const config: AppConfig = {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 0,
    databaseMode: "memory",
    databaseUrl: "",
    sessionSecret: "test-session-secret-1234567890",
    sessionIdleTtlSeconds: 1800,
    sessionMaxTtlSeconds: 604800,
    webOrigin: "http://localhost:5173",
    adminDataDir: dataDir
  };
  const app = createApp(config, repository);
  await app.ready();
  configs.push(config);
  apps.push(app);
  return { app, repository, dataDir };
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const config of configs.splice(0)) await rm(config.adminDataDir, { recursive: true, force: true });
});

describe("loan API", () => {
  it("logs in, creates a mixed loan, and returns a deterministic schedule", async () => {
    const { app } = await setup();
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "admin", password: "password-123456" } });
    expect(login.statusCode).toBe(200);
    const cookie = login.cookies[0];
    const create = await app.inject({ method: "POST", url: "/api/loans", cookies: { [cookie!.name]: cookie!.value }, payload: { name: "API 测试贷款", notes: "", components: [{ componentType: "commercial", principal: "100000.00", disbursementDate: "2026-01-01", firstPaymentDate: "2026-01-31", termMonths: 12, repaymentMethod: "equal_payment", initialRate: "0.03600000" }, { componentType: "provident_fund", principal: "50000.00", disbursementDate: "2026-01-01", firstPaymentDate: "2026-02-28", termMonths: 12, repaymentMethod: "equal_principal", initialRate: "0.02750000" }] } });
    expect(create.statusCode).toBe(201);
    const loanId = create.json().loan.id as string;
    const schedule = await app.inject({ method: "GET", url: `/api/loans/${loanId}/schedule?asOf=2026-06-30`, cookies: { [cookie!.name]: cookie!.value } });
    expect(schedule.statusCode).toBe(200);
    expect(schedule.json().schedule.metrics.originalPrincipal).toBe("150000.00");
    expect(schedule.json().schedule.components).toHaveLength(2);
  });

  it("keeps prepayment preview side-effect free and supports backup preview", async () => {
    const { app, repository } = await setup();
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "admin", password: "password-123456" } });
    const cookie = login.cookies[0]!;
    const create = await app.inject({ method: "POST", url: "/api/loans", cookies: { [cookie.name]: cookie.value }, payload: { name: "Preview 测试", notes: "", components: [{ componentType: "commercial", principal: "100000.00", disbursementDate: "2026-01-01", firstPaymentDate: "2026-01-31", termMonths: 24, repaymentMethod: "equal_payment", initialRate: "0.03600000" }] } });
    const loanId = create.json().loan.id as string;
    const componentId = create.json().loan.components[0].id as string;
    const preview = await app.inject({ method: "POST", url: `/api/loans/${loanId}/prepayment-preview?asOf=2026-02-28`, cookies: { [cookie.name]: cookie.value }, payload: { date: "2026-06-01", strategy: "reduce_payment", components: [{ componentId, amount: "10000.00" }] } });
    expect(preview.statusCode).toBe(200);
    expect(Number(preview.json().savedInterest)).toBeGreaterThan(0);
    expect((await repository.listScenarios(loanId))).toHaveLength(0);
    const backup = await app.inject({ method: "GET", url: "/api/export/backup.json", cookies: { [cookie.name]: cookie.value } });
    expect(backup.statusCode).toBe(200);
    const backupPreview = await app.inject({ method: "POST", url: "/api/import/backup/preview", cookies: { [cookie.name]: cookie.value }, payload: backup.json() });
    expect(backupPreview.statusCode).toBe(200);
    expect(backupPreview.json().counts.loans).toBe(1);
  });
});
