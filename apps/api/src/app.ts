import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Decimal from "decimal.js";
import {
  assertDate,
  comparePrepayment,
  generateLoanSchedule,
  type ComponentInput,
  type PrepaymentEvent
} from "@loan-console/calculation";
import type { DashboardSummary, LoanCase, LoanCaseInput, LoanComponent, PrepaymentInput } from "@loan-console/shared";
import {
  backupSchema,
  loanInputSchema,
  loginSchema,
  prepaymentInputSchema,
  ratePeriodInputSchema
} from "@loan-console/validation";
import type { AppConfig } from "./config.js";
import { AuthService } from "./auth.js";
import type { Repository, SavedScenario } from "./repositories/types.js";

const CALCULATION_VERSION = "1";

function addMoney(left: string, right: string): string {
  return new Decimal(left).plus(right).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

function todayShanghai(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

function queryAsOf(request: FastifyRequest): string {
  const query = request.query as { asOf?: string };
  return query.asOf ?? todayShanghai();
}

function componentToCalculation(component: LoanComponent): ComponentInput {
  return {
    id: component.id,
    principal: component.principal,
    disbursementDate: component.disbursementDate,
    firstPaymentDate: component.firstPaymentDate,
    termMonths: component.termMonths,
    repaymentMethod: component.repaymentMethod,
    ratePeriods: component.ratePeriods.map((period) => ({ id: period.id, effectiveDate: period.effectiveDate, annualRate: period.annualRate }))
  };
}

function ensureLoan(loan: LoanCase | null): LoanCase {
  if (!loan) throw new HttpError(404, "LOAN_NOT_FOUND", "贷款不存在");
  return loan;
}

function ensureComponent(loan: LoanCase, componentId: string): LoanComponent {
  const component = loan.components.find((item) => item.id === componentId);
  if (!component) throw new HttpError(404, "COMPONENT_NOT_FOUND", "贷款分项不存在");
  return component;
}

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

class HttpError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
  }
}

function parseBody<T>(schema: { parse: (input: unknown) => T }, body: unknown): T {
  try {
    return schema.parse(body);
  } catch (error) {
    throw new HttpError(400, "VALIDATION_ERROR", "请求数据校验失败", error);
  }
}

function parseJsonBody(body: unknown): unknown {
  if (typeof body === "string") {
    try { return JSON.parse(body); } catch { throw new HttpError(400, "INVALID_JSON", "请求体不是有效 JSON"); }
  }
  return body;
}

function buildBackup(repositoryData: Awaited<ReturnType<Repository["exportBackup"]>>) {
  return {
    format: "loan-console-backup" as const,
    schemaVersion: 1,
    calculationVersion: CALCULATION_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: "1.0.0",
    data: repositoryData
  };
}

function normalizeBackup(input: unknown) {
  const parsed = parseBody(backupSchema, parseJsonBody(input));
  if (parsed.schemaVersion !== 1) throw new HttpError(400, "UNSUPPORTED_BACKUP_VERSION", "不支持的备份版本");
  const data = parsed.data as unknown as Awaited<ReturnType<Repository["exportBackup"]>>;
  if (!Array.isArray(data.loanCases)) throw new HttpError(400, "INVALID_BACKUP_DATA", "备份缺少贷款数据");
  return data;
}

export function createApp(config: AppConfig, repository: Repository): FastifyInstance {
  const app = Fastify({ logger: config.nodeEnv !== "test" });
  const auth = new AuthService(repository, config);
  const pendingImports = new Map<string, { expiresAt: number; data: Awaited<ReturnType<Repository["exportBackup"]>> }>();

  app.register(cookie);
  app.register(helmet, { contentSecurityPolicy: false });
  app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  app.addHook("onRequest", async (request, reply) => {
    if (!["POST", "PATCH", "DELETE"].includes(request.method)) return;
    const origin = request.headers.origin;
    if (origin && origin !== config.webOrigin) {
      return reply.code(403).send({ error: { code: "ORIGIN_NOT_ALLOWED", message: "请求来源不受信任" } });
    }
  });

  app.decorateRequest("user", null);

  const requireAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await auth.authenticate(request);
    if (!user) return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "请先登录" } });
    (request as FastifyRequest & { user: { id: string; username: string } }).user = user;
  };

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
    request.log.error(error);
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "服务器内部错误" } });
  });

  app.get("/api/health", async () => ({ status: "ok", databaseMode: config.databaseMode, version: "1.0.0" }));

  app.post("/api/auth/login", { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } }, async (request, reply) => {
    const input = parseBody(loginSchema, request.body);
    try {
      const user = await auth.login(input.username, input.password, reply);
      return { user };
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_CREDENTIALS") throw new HttpError(401, "INVALID_CREDENTIALS", "用户名或密码错误");
      throw error;
    }
  });

  app.post("/api/auth/logout", async (request, reply) => { await auth.logout(request, reply); return { ok: true }; });
  app.get("/api/auth/me", { preHandler: requireAuth }, async (request) => ({ user: (request as FastifyRequest & { user: unknown }).user }));

  app.get("/api/loans", { preHandler: requireAuth }, async () => ({ loans: await repository.listLoanCases() }));

  app.post("/api/loans", { preHandler: requireAuth }, async (request, reply) => {
    const input = parseBody(loanInputSchema, request.body) as LoanCaseInput;
    generateLoanSchedule(input.components.map((component, index) => ({
      id: `draft-${index}`,
      principal: component.principal,
      disbursementDate: component.disbursementDate,
      firstPaymentDate: component.firstPaymentDate,
      termMonths: component.termMonths,
      repaymentMethod: component.repaymentMethod,
      ratePeriods: [{ effectiveDate: component.disbursementDate, annualRate: component.initialRate }]
    })), todayShanghai());
    const loan = await repository.createLoanCase(input);
    return reply.code(201).send({ loan });
  });

  app.get("/api/loans/:id", { preHandler: requireAuth }, async (request) => {
    const loan = ensureLoan(await repository.getLoanCase((request.params as { id: string }).id));
    return { loan };
  });

  app.patch("/api/loans/:id", { preHandler: requireAuth }, async (request) => {
    const body = request.body as Record<string, unknown>;
    const allowed = Object.keys(body).every((key) => key === "name" || key === "notes");
    if (!allowed) throw new HttpError(400, "IMMUTABLE_TERMS", "贷款核心条款不可通过普通接口修改");
    const update: { name?: string; notes?: string } = {};
    if (typeof body.name === "string") update.name = body.name;
    if (typeof body.notes === "string") update.notes = body.notes;
    const loan = await repository.updateLoanCase((request.params as { id: string }).id, update);
    return { loan };
  });

  app.delete("/api/loans/:id", { preHandler: requireAuth }, async (request, reply) => {
    await repository.deleteLoanCase((request.params as { id: string }).id);
    return reply.code(204).send();
  });

  app.get("/api/loans/:id/schedule", { preHandler: requireAuth }, async (request) => {
    const loan = ensureLoan(await repository.getLoanCase((request.params as { id: string }).id));
    const asOf = queryAsOf(request);
    const schedule = generateLoanSchedule(loan.components.map(componentToCalculation), asOf);
    return { loanCase: loan, schedule, componentRows: Object.fromEntries(schedule.components.map((item) => [item.componentId, item.rows])), asOf };
  });

  app.post("/api/loans/:loanId/components/:componentId/rate-periods", { preHandler: requireAuth }, async (request, reply) => {
    const params = request.params as { loanId: string; componentId: string };
    const loan = ensureLoan(await repository.getLoanCase(params.loanId));
    ensureComponent(loan, params.componentId);
    const input = parseBody(ratePeriodInputSchema, request.body);
    assertDate(input.effectiveDate, "rate effective date");
    assertDate(input.effectiveDate, "rate effective date");
    const asOf = todayShanghai();
    if (input.effectiveDate <= asOf && (request.query as { confirmDangerous?: string }).confirmDangerous !== "true") throw new HttpError(409, "DANGEROUS_HISTORICAL_CHANGE", "历史利率变更需要 confirmDangerous=true");
    const ratePeriod = await repository.addRatePeriod(params.componentId, input);
    return reply.code(201).send({ ratePeriod });
  });

  app.patch("/api/loans/:loanId/components/:componentId/rate-periods/:ratePeriodId", { preHandler: requireAuth }, async (request) => {
    const params = request.params as { loanId: string; componentId: string; ratePeriodId: string };
    const loan = ensureLoan(await repository.getLoanCase(params.loanId));
    ensureComponent(loan, params.componentId);
    const input = parseBody(ratePeriodInputSchema, request.body);
    if (input.effectiveDate <= todayShanghai() && (request.query as { confirmDangerous?: string }).confirmDangerous !== "true") throw new HttpError(409, "DANGEROUS_HISTORICAL_CHANGE", "历史利率变更需要 confirmDangerous=true");
    return { ratePeriod: await repository.updateRatePeriod(params.ratePeriodId, input) };
  });

  app.delete("/api/loans/:loanId/components/:componentId/rate-periods/:ratePeriodId", { preHandler: requireAuth }, async (request, reply) => {
    const params = request.params as { loanId: string; componentId: string; ratePeriodId: string };
    const loan = ensureLoan(await repository.getLoanCase(params.loanId));
    ensureComponent(loan, params.componentId);
    if ((request.query as { confirmDangerous?: string }).confirmDangerous !== "true") throw new HttpError(409, "DANGEROUS_HISTORICAL_CHANGE", "删除利率记录需要 confirmDangerous=true");
    await repository.deleteRatePeriod(params.ratePeriodId);
    return reply.code(204).send();
  });

  const calculatePrepayment = async (request: FastifyRequest) => {
    const params = request.params as { id: string };
    const loan = ensureLoan(await repository.getLoanCase(params.id));
    const input = parseBody(prepaymentInputSchema, request.body) as PrepaymentInput;
    const knownIds = new Set(loan.components.map((component) => component.id));
    if (input.components.some((item) => !knownIds.has(item.componentId))) throw new HttpError(400, "INVALID_COMPONENT", "提前还款分项不属于该贷款");
    const asOf = queryAsOf(request);
    const event: PrepaymentEvent = { date: input.date, strategy: input.strategy, allocations: input.components };
    return { loan, input, asOf, comparison: comparePrepayment(loan.components.map(componentToCalculation), asOf, event) };
  };

  app.post("/api/loans/:id/prepayment-preview", { preHandler: requireAuth }, async (request) => {
    const result = await calculatePrepayment(request);
    return result.comparison;
  });

  app.post("/api/loans/:id/prepayment-scenarios", { preHandler: requireAuth }, async (request, reply) => {
    const result = await calculatePrepayment(request);
    const scenario: Omit<SavedScenario, "createdAt"> = {
      id: randomUUID(),
      loanCaseId: result.loan.id,
      prepaymentDate: result.input.date,
      strategy: result.input.strategy,
      inputSnapshotJson: result.input,
      resultSnapshotJson: result.comparison,
      calculationVersion: CALCULATION_VERSION
    };
    const saved = await repository.saveScenario(scenario);
    return reply.code(201).send({ scenario: saved });
  });

  app.get("/api/loans/:id/prepayment-scenarios", { preHandler: requireAuth }, async (request) => ({ scenarios: await repository.listScenarios((request.params as { id: string }).id) }));
  app.get("/api/loans/:id/prepayment-scenarios/:scenarioId", { preHandler: requireAuth }, async (request) => {
    const scenario = await repository.getScenario((request.params as { scenarioId: string }).scenarioId);
    if (!scenario) throw new HttpError(404, "SCENARIO_NOT_FOUND", "提前还款方案不存在");
    return { scenario };
  });
  app.delete("/api/loans/:id/prepayment-scenarios/:scenarioId", { preHandler: requireAuth }, async (request, reply) => {
    await repository.deleteScenario((request.params as { scenarioId: string }).scenarioId);
    return reply.code(204).send();
  });

  app.get("/api/dashboard/summary", { preHandler: requireAuth }, async (request) => {
    const asOf = queryAsOf(request);
    const loans = await repository.listLoanCases();
    const summaries: DashboardSummary["loans"] = [];
    let totals = generateLoanSchedule([], asOf).metrics;
    const byComponentType: DashboardSummary["byComponentType"] = { commercial: "0.00", provident_fund: "0.00" };
    for (const loan of loans) {
      const schedule = generateLoanSchedule(loan.components.map(componentToCalculation), asOf);
      summaries.push({ id: loan.id, name: loan.name, originalPrincipal: schedule.metrics.originalPrincipal, remainingPrincipal: schedule.metrics.remainingPrincipal, nextPayment: schedule.metrics.nextPayment, nextPaymentDate: schedule.metrics.nextPaymentDate, remainingInterest: schedule.metrics.remainingInterest, payoffDate: schedule.metrics.payoffDate });
      totals = {
        originalPrincipal: addMoney(totals.originalPrincipal, schedule.metrics.originalPrincipal),
        remainingPrincipal: addMoney(totals.remainingPrincipal, schedule.metrics.remainingPrincipal),
        paidPrincipal: addMoney(totals.paidPrincipal, schedule.metrics.paidPrincipal),
        paidInterest: addMoney(totals.paidInterest, schedule.metrics.paidInterest),
        remainingInterest: addMoney(totals.remainingInterest, schedule.metrics.remainingInterest),
        totalInterest: addMoney(totals.totalInterest, schedule.metrics.totalInterest),
        remainingPeriods: Math.max(totals.remainingPeriods, schedule.metrics.remainingPeriods),
        payoffDate: !totals.payoffDate || (schedule.metrics.payoffDate && schedule.metrics.payoffDate > totals.payoffDate) ? schedule.metrics.payoffDate : totals.payoffDate,
        nextPayment: addMoney(totals.nextPayment, schedule.metrics.nextPayment),
        nextPaymentDate: !totals.nextPaymentDate || (schedule.metrics.nextPaymentDate && schedule.metrics.nextPaymentDate < totals.nextPaymentDate) ? schedule.metrics.nextPaymentDate : totals.nextPaymentDate
      };
      for (const component of loan.components) {
        const componentSchedule = schedule.components.find((item) => item.componentId === component.id);
        if (componentSchedule) byComponentType[component.componentType] = addMoney(byComponentType[component.componentType], componentSchedule.metrics.remainingPrincipal);
      }
    }
    return { asOf, loans: summaries, totals, byComponentType } satisfies DashboardSummary;
  });

  app.get("/api/export/backup.json", { preHandler: requireAuth }, async (_request, reply) => {
    return reply.header("Content-Disposition", "attachment; filename=loan-console-backup.json").type("application/json").send(buildBackup(await repository.exportBackup()));
  });

  app.post("/api/import/backup/preview", { preHandler: requireAuth }, async (request) => {
    const data = normalizeBackup(request.body);
    const previewId = randomUUID();
    pendingImports.set(previewId, { expiresAt: Date.now() + 5 * 60 * 1000, data });
    return { previewId, counts: { loans: data.loanCases.length, components: data.loanComponents.length, ratePeriods: data.ratePeriods.length, scenarios: data.prepaymentScenarios.length }, calculationVersion: CALCULATION_VERSION };
  });

  app.post("/api/import/backup/commit", { preHandler: requireAuth }, async (request) => {
    const previewId = (request.body as { previewId?: string })?.previewId;
    if (!previewId) throw new HttpError(400, "PREVIEW_REQUIRED", "缺少 previewId");
    const pending = pendingImports.get(previewId);
    if (!pending || pending.expiresAt < Date.now()) {
      pendingImports.delete(previewId);
      throw new HttpError(410, "PREVIEW_EXPIRED", "备份预览已过期，请重新上传");
    }
    await repository.replaceBusinessData(pending.data);
    pendingImports.delete(previewId);
    return { ok: true };
  });

  app.get("/api/export/summary.csv", { preHandler: requireAuth }, async (request, reply) => {
    const asOf = queryAsOf(request);
    const loans = await repository.listLoanCases();
    const lines = ["loan_case_name,component_type,original_principal,planned_remaining_principal,annual_rate,repayment_method,original_term_months,planned_remaining_periods,planned_paid_interest,planned_remaining_interest,planned_payoff_date"];
    for (const loan of loans) {
      const schedule = generateLoanSchedule(loan.components.map(componentToCalculation), asOf);
      for (const component of loan.components) {
        const componentSchedule = schedule.components.find((item) => item.componentId === component.id);
        const lastRate = [...component.ratePeriods].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0]?.annualRate ?? "0";
        lines.push([loan.name, component.componentType, component.principal, componentSchedule?.metrics.remainingPrincipal ?? "0.00", lastRate, component.repaymentMethod, component.termMonths, componentSchedule?.metrics.remainingPeriods ?? 0, componentSchedule?.metrics.paidInterest ?? "0.00", componentSchedule?.metrics.remainingInterest ?? "0.00", componentSchedule?.metrics.payoffDate ?? ""].map(csvCell).join(","));
      }
    }
    return reply.header("Content-Disposition", "attachment; filename=loan-summary.csv").type("text/csv; charset=utf-8").send(`\uFEFF${lines.join("\n")}`);
  });

  app.addHook("onClose", async () => { /* DB pool is owned by server bootstrap. */ });
  return app;
}
