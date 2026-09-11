import { and, asc, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { LoanCase, LoanCaseInput, LoanComponent, RatePeriod } from "@loan-console/shared";
import type { Database } from "../db/client.js";
import { authSessions, loanCases, loanComponents, prepaymentAllocations, prepaymentScenarios, ratePeriods, users } from "../db/schema.js";
import type { BackupData, Repository, SavedScenario, SessionRecord, UserRecord } from "./types.js";
import { nowSql } from "./types.js";

function toUser(row: typeof users.$inferSelect): UserRecord {
  return { id: row.id, username: row.username, passwordHash: row.passwordHash, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function toSession(row: typeof authSessions.$inferSelect): SessionRecord {
  return { id: row.id, userId: row.userId, sessionTokenHash: row.sessionTokenHash, expiresAt: row.expiresAt, lastSeenAt: row.lastSeenAt, createdAt: row.createdAt };
}

export class SqlRepository implements Repository {
  constructor(private readonly db: Database) {}

  async findUserByUsername(username: string): Promise<UserRecord | null> {
    const [row] = await this.db.select().from(users).where(eq(users.username, username)).limit(1);
    return row ? toUser(row) : null;
  }

  async findUserById(userId: string): Promise<UserRecord | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    return row ? toUser(row) : null;
  }

  async createUser(input: { username: string; passwordHash: string }): Promise<UserRecord> {
    const timestamp = nowSql();
    const user = { id: randomUUID(), username: input.username, passwordHash: input.passwordHash, createdAt: timestamp, updatedAt: timestamp };
    await this.db.insert(users).values(user);
    return user;
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    await this.db.update(users).set({ passwordHash, updatedAt: nowSql() }).where(eq(users.id, userId));
  }

  async deleteSessionsForUser(userId: string): Promise<void> {
    await this.db.delete(authSessions).where(eq(authSessions.userId, userId));
  }

  async createSession(input: Omit<SessionRecord, "createdAt"> & { createdAt?: string }): Promise<SessionRecord> {
    const session = { ...input, createdAt: input.createdAt ?? nowSql() };
    await this.db.insert(authSessions).values(session);
    return session;
  }

  async findSessionByHash(sessionTokenHash: string): Promise<SessionRecord | null> {
    const [row] = await this.db.select().from(authSessions).where(eq(authSessions.sessionTokenHash, sessionTokenHash)).limit(1);
    return row ? toSession(row) : null;
  }

  async touchSession(sessionId: string, lastSeenAt: string, expiresAt: string): Promise<void> {
    await this.db.update(authSessions).set({ lastSeenAt, expiresAt }).where(eq(authSessions.id, sessionId));
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.db.delete(authSessions).where(eq(authSessions.id, sessionId));
  }

  private async componentsForCase(loanCaseId: string): Promise<LoanComponent[]> {
    const componentRows = await this.db.select().from(loanComponents).where(eq(loanComponents.loanCaseId, loanCaseId)).orderBy(asc(loanComponents.componentType));
    const result: LoanComponent[] = [];
    for (const row of componentRows) {
      const rateRows = await this.db.select().from(ratePeriods).where(eq(ratePeriods.componentId, row.id)).orderBy(asc(ratePeriods.effectiveDate));
      result.push({
        id: row.id,
        loanCaseId: row.loanCaseId,
        componentType: row.componentType as LoanComponent["componentType"],
        principal: String(row.principal),
        disbursementDate: row.disbursementDate,
        firstPaymentDate: row.firstPaymentDate,
        termMonths: row.termMonths,
        repaymentMethod: row.repaymentMethod as LoanComponent["repaymentMethod"],
        ratePeriods: rateRows.map((rate) => ({ id: rate.id, componentId: rate.componentId, effectiveDate: rate.effectiveDate, annualRate: String(rate.annualRate), createdAt: rate.createdAt })),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      });
    }
    return result;
  }

  async listLoanCases(): Promise<LoanCase[]> {
    const rows = await this.db.select().from(loanCases).orderBy(desc(loanCases.updatedAt));
    return Promise.all(rows.map(async (row) => ({ ...row, components: await this.componentsForCase(row.id) })));
  }

  async getLoanCase(id: string): Promise<LoanCase | null> {
    const [row] = await this.db.select().from(loanCases).where(eq(loanCases.id, id)).limit(1);
    return row ? { ...row, components: await this.componentsForCase(row.id) } : null;
  }

  async createLoanCase(input: LoanCaseInput): Promise<LoanCase> {
    const timestamp = nowSql();
    const loanCaseId = randomUUID();
    await this.db.transaction(async (transaction) => {
      await transaction.insert(loanCases).values({ id: loanCaseId, name: input.name, notes: input.notes ?? "", createdAt: timestamp, updatedAt: timestamp });
      for (const component of input.components) {
        const componentId = randomUUID();
        await transaction.insert(loanComponents).values({
          id: componentId,
          loanCaseId,
          componentType: component.componentType,
          principal: component.principal,
          disbursementDate: component.disbursementDate,
          firstPaymentDate: component.firstPaymentDate,
          termMonths: component.termMonths,
          repaymentMethod: component.repaymentMethod,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        await transaction.insert(ratePeriods).values({ id: randomUUID(), componentId, effectiveDate: component.disbursementDate, annualRate: component.initialRate, createdAt: timestamp });
      }
    });
    return (await this.getLoanCase(loanCaseId))!;
  }

  async updateLoanCase(id: string, input: Partial<Pick<LoanCaseInput, "name" | "notes">>): Promise<LoanCase> {
    await this.db.update(loanCases).set({ ...input, updatedAt: nowSql() }).where(eq(loanCases.id, id));
    const loan = await this.getLoanCase(id);
    if (!loan) throw new Error("LOAN_NOT_FOUND");
    return loan;
  }

  async deleteLoanCase(id: string): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const components = await transaction.select({ id: loanComponents.id }).from(loanComponents).where(eq(loanComponents.loanCaseId, id));
      const scenarios = await transaction.select({ id: prepaymentScenarios.id }).from(prepaymentScenarios).where(eq(prepaymentScenarios.loanCaseId, id));
      for (const scenario of scenarios) await transaction.delete(prepaymentAllocations).where(eq(prepaymentAllocations.scenarioId, scenario.id));
      await transaction.delete(prepaymentScenarios).where(eq(prepaymentScenarios.loanCaseId, id));
      for (const component of components) await transaction.delete(ratePeriods).where(eq(ratePeriods.componentId, component.id));
      for (const component of components) await transaction.delete(prepaymentAllocations).where(eq(prepaymentAllocations.componentId, component.id));
      await transaction.delete(loanComponents).where(eq(loanComponents.loanCaseId, id));
      await transaction.delete(loanCases).where(eq(loanCases.id, id));
    });
  }

  async addRatePeriod(componentId: string, input: { effectiveDate: string; annualRate: string }): Promise<RatePeriod> {
    const [existing] = await this.db.select().from(ratePeriods).where(and(eq(ratePeriods.componentId, componentId), eq(ratePeriods.effectiveDate, input.effectiveDate))).limit(1);
    if (existing) throw new Error("DUPLICATE_RATE_DATE");
    const value = { id: randomUUID(), componentId, effectiveDate: input.effectiveDate, annualRate: input.annualRate, createdAt: nowSql() };
    await this.db.insert(ratePeriods).values(value);
    return { ...value };
  }

  async updateRatePeriod(id: string, input: { effectiveDate: string; annualRate: string }): Promise<RatePeriod> {
    const [current] = await this.db.select().from(ratePeriods).where(eq(ratePeriods.id, id)).limit(1);
    if (!current) throw new Error("RATE_PERIOD_NOT_FOUND");
    const [duplicate] = await this.db.select().from(ratePeriods).where(and(eq(ratePeriods.componentId, current.componentId), eq(ratePeriods.effectiveDate, input.effectiveDate))).limit(1);
    if (duplicate && duplicate.id !== id) throw new Error("DUPLICATE_RATE_DATE");
    await this.db.update(ratePeriods).set(input).where(eq(ratePeriods.id, id));
    return { id, componentId: current.componentId, effectiveDate: input.effectiveDate, annualRate: input.annualRate, createdAt: current.createdAt };
  }

  async deleteRatePeriod(id: string): Promise<void> {
    const [current] = await this.db.select().from(ratePeriods).where(eq(ratePeriods.id, id)).limit(1);
    if (!current) throw new Error("RATE_PERIOD_NOT_FOUND");
    const count = await this.db.select({ id: ratePeriods.id }).from(ratePeriods).where(eq(ratePeriods.componentId, current.componentId));
    if (count.length <= 1) throw new Error("CANNOT_DELETE_INITIAL_RATE");
    await this.db.delete(ratePeriods).where(eq(ratePeriods.id, id));
  }

  async saveScenario(input: Omit<SavedScenario, "createdAt"> & { createdAt?: string }): Promise<SavedScenario> {
    const scenario = { ...input, createdAt: input.createdAt ?? nowSql() };
    await this.db.transaction(async (transaction) => {
      await transaction.insert(prepaymentScenarios).values({
        id: scenario.id,
        loanCaseId: scenario.loanCaseId,
        prepaymentDate: scenario.prepaymentDate,
        strategy: scenario.strategy,
        inputSnapshotJson: scenario.inputSnapshotJson,
        resultSnapshotJson: scenario.resultSnapshotJson,
        calculationVersion: scenario.calculationVersion,
        createdAt: scenario.createdAt
      });
      await transaction.insert(prepaymentAllocations).values(scenario.inputSnapshotJson.components.map((allocation) => ({ id: randomUUID(), scenarioId: scenario.id, componentId: allocation.componentId, amount: allocation.amount })));
    });
    return scenario;
  }

  async listScenarios(loanCaseId: string): Promise<SavedScenario[]> {
    const rows = await this.db.select().from(prepaymentScenarios).where(eq(prepaymentScenarios.loanCaseId, loanCaseId)).orderBy(desc(prepaymentScenarios.createdAt));
    return rows.map((row) => ({
      id: row.id,
      loanCaseId: row.loanCaseId,
      prepaymentDate: row.prepaymentDate,
      strategy: row.strategy as SavedScenario["strategy"],
      inputSnapshotJson: row.inputSnapshotJson as SavedScenario["inputSnapshotJson"],
      resultSnapshotJson: row.resultSnapshotJson as SavedScenario["resultSnapshotJson"],
      calculationVersion: row.calculationVersion,
      createdAt: row.createdAt
    }));
  }

  async getScenario(id: string): Promise<SavedScenario | null> {
    const [row] = await this.db.select().from(prepaymentScenarios).where(eq(prepaymentScenarios.id, id)).limit(1);
    return row ? {
      id: row.id,
      loanCaseId: row.loanCaseId,
      prepaymentDate: row.prepaymentDate,
      strategy: row.strategy as SavedScenario["strategy"],
      inputSnapshotJson: row.inputSnapshotJson as SavedScenario["inputSnapshotJson"],
      resultSnapshotJson: row.resultSnapshotJson as SavedScenario["resultSnapshotJson"],
      calculationVersion: row.calculationVersion,
      createdAt: row.createdAt
    } : null;
  }

  async deleteScenario(id: string): Promise<void> {
    await this.db.delete(prepaymentAllocations).where(eq(prepaymentAllocations.scenarioId, id));
    await this.db.delete(prepaymentScenarios).where(eq(prepaymentScenarios.id, id));
  }

  async exportBackup(): Promise<BackupData> {
    const cases = await this.listLoanCases();
    const scenarios = (await Promise.all(cases.map((loan) => this.listScenarios(loan.id)))).flat();
    const allocations = scenarios.flatMap((scenario) => scenario.inputSnapshotJson.components.map((item) => ({ id: randomUUID(), scenarioId: scenario.id, componentId: item.componentId, amount: item.amount })));
    return {
      loanCases: cases,
      loanComponents: cases.flatMap((loan) => loan.components),
      ratePeriods: cases.flatMap((loan) => loan.components.flatMap((component) => component.ratePeriods)),
      prepaymentScenarios: scenarios,
      prepaymentAllocations: allocations
    };
  }

  async replaceBusinessData(data: BackupData): Promise<void> {
    await this.db.transaction(async (transaction) => {
      await transaction.delete(prepaymentAllocations);
      await transaction.delete(prepaymentScenarios);
      await transaction.delete(ratePeriods);
      await transaction.delete(loanComponents);
      await transaction.delete(loanCases);
      for (const loan of data.loanCases) {
        await transaction.insert(loanCases).values({ id: loan.id, name: loan.name, notes: loan.notes, createdAt: loan.createdAt, updatedAt: loan.updatedAt });
        for (const component of loan.components) {
          await transaction.insert(loanComponents).values({ id: component.id, loanCaseId: loan.id, componentType: component.componentType, principal: component.principal, disbursementDate: component.disbursementDate, firstPaymentDate: component.firstPaymentDate, termMonths: component.termMonths, repaymentMethod: component.repaymentMethod, createdAt: component.createdAt, updatedAt: component.updatedAt });
          await transaction.insert(ratePeriods).values(component.ratePeriods.map((period) => ({ id: period.id ?? randomUUID(), componentId: component.id, effectiveDate: period.effectiveDate, annualRate: period.annualRate, createdAt: period.createdAt })));
        }
      }
      for (const scenario of data.prepaymentScenarios) {
        await transaction.insert(prepaymentScenarios).values({ id: scenario.id, loanCaseId: scenario.loanCaseId, prepaymentDate: scenario.prepaymentDate, strategy: scenario.strategy, inputSnapshotJson: scenario.inputSnapshotJson, resultSnapshotJson: scenario.resultSnapshotJson, calculationVersion: scenario.calculationVersion, createdAt: scenario.createdAt });
        await transaction.insert(prepaymentAllocations).values(scenario.inputSnapshotJson.components.map((allocation) => ({ id: randomUUID(), scenarioId: scenario.id, componentId: allocation.componentId, amount: allocation.amount })));
      }
    });
  }
}
