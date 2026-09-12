import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { LoanCase, LoanCaseInput, LoanComponent, RatePeriod } from "@loan-console/shared";
import type { BackupData, Repository, SavedScenario, SessionRecord, UserRecord } from "./types.js";
import { nowIso } from "./types.js";

type MemoryState = {
  users: UserRecord[];
  sessions: SessionRecord[];
  loanCases: LoanCase[];
  scenarios: SavedScenario[];
  allocations: BackupData["prepaymentAllocations"];
};

function emptyState(): MemoryState {
  return { users: [], sessions: [], loanCases: [], scenarios: [], allocations: [] };
}

export class MemoryRepository implements Repository {
  private state: MemoryState = emptyState();
  private loaded = false;

  constructor(private readonly dataDir: string) {}

  private get filePath(): string {
    return join(this.dataDir, "memory-state.json");
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const content = await readFile(this.filePath, "utf8");
      this.state = JSON.parse(content) as MemoryState;
    } catch {
      this.state = emptyState();
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  async findUserByUsername(username: string): Promise<UserRecord | null> {
    await this.ensureLoaded();
    return this.state.users.find((user) => user.username === username) ?? null;
  }

  async findUserById(userId: string): Promise<UserRecord | null> {
    await this.ensureLoaded();
    return this.state.users.find((user) => user.id === userId) ?? null;
  }

  async createUser(input: { username: string; passwordHash: string }): Promise<UserRecord> {
    await this.ensureLoaded();
    if (this.state.users.some((user) => user.username === input.username)) throw new Error("USERNAME_EXISTS");
    const timestamp = nowIso();
    const user = { id: randomUUID(), username: input.username, passwordHash: input.passwordHash, createdAt: timestamp, updatedAt: timestamp };
    this.state.users = [...this.state.users, user];
    await this.persist();
    return user;
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    await this.ensureLoaded();
    const user = this.state.users.find((item) => item.id === userId);
    if (!user) throw new Error("USER_NOT_FOUND");
    user.passwordHash = passwordHash;
    user.updatedAt = nowIso();
    await this.persist();
  }

  async deleteSessionsForUser(userId: string): Promise<void> {
    await this.ensureLoaded();
    this.state.sessions = this.state.sessions.filter((session) => session.userId !== userId);
    await this.persist();
  }

  async createSession(input: Omit<SessionRecord, "createdAt"> & { createdAt?: string }): Promise<SessionRecord> {
    await this.ensureLoaded();
    const session = { ...input, createdAt: input.createdAt ?? nowIso() };
    this.state.sessions = [...this.state.sessions, session];
    await this.persist();
    return session;
  }

  async findSessionByHash(sessionTokenHash: string): Promise<SessionRecord | null> {
    await this.ensureLoaded();
    return this.state.sessions.find((session) => session.sessionTokenHash === sessionTokenHash) ?? null;
  }

  async touchSession(sessionId: string, lastSeenAt: string, expiresAt: string): Promise<void> {
    await this.ensureLoaded();
    const session = this.state.sessions.find((item) => item.id === sessionId);
    if (session) {
      session.lastSeenAt = lastSeenAt;
      session.expiresAt = expiresAt;
      await this.persist();
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.ensureLoaded();
    this.state.sessions = this.state.sessions.filter((session) => session.id !== sessionId);
    await this.persist();
  }

  async listLoanCases(): Promise<LoanCase[]> {
    await this.ensureLoaded();
    return structuredClone(this.state.loanCases);
  }

  async getLoanCase(id: string): Promise<LoanCase | null> {
    await this.ensureLoaded();
    const item = this.state.loanCases.find((loan) => loan.id === id);
    return item ? structuredClone(item) : null;
  }

  async createLoanCase(input: LoanCaseInput): Promise<LoanCase> {
    await this.ensureLoaded();
    const timestamp = nowIso();
    const loanCaseId = randomUUID();
    const components: LoanComponent[] = input.components.map((component) => {
      const id = randomUUID();
      const rateId = randomUUID();
      return {
        id,
        loanCaseId,
        componentType: component.componentType,
        principal: component.principal,
        disbursementDate: component.disbursementDate,
        firstPaymentDate: component.firstPaymentDate,
        termMonths: component.termMonths,
        repaymentMethod: component.repaymentMethod,
        ratePeriods: [{ id: rateId, componentId: id, effectiveDate: component.disbursementDate, annualRate: component.initialRate, createdAt: timestamp }],
        createdAt: timestamp,
        updatedAt: timestamp
      };
    });
    const loan: LoanCase = { id: loanCaseId, name: input.name, notes: input.notes ?? "", components, createdAt: timestamp, updatedAt: timestamp };
    this.state.loanCases = [...this.state.loanCases, loan];
    await this.persist();
    return structuredClone(loan);
  }

  async updateLoanCase(id: string, input: Partial<Pick<LoanCaseInput, "name" | "notes">>): Promise<LoanCase> {
    await this.ensureLoaded();
    const loan = this.state.loanCases.find((item) => item.id === id);
    if (!loan) throw new Error("LOAN_NOT_FOUND");
    if (input.name !== undefined) loan.name = input.name;
    if (input.notes !== undefined) loan.notes = input.notes;
    loan.updatedAt = nowIso();
    await this.persist();
    return structuredClone(loan);
  }

  async deleteLoanCase(id: string): Promise<void> {
    await this.ensureLoaded();
    this.state.loanCases = this.state.loanCases.filter((loan) => loan.id !== id);
    this.state.scenarios = this.state.scenarios.filter((scenario) => scenario.loanCaseId !== id);
    this.state.allocations = this.state.allocations.filter((allocation) => this.state.scenarios.some((scenario) => scenario.id === allocation.scenarioId));
    await this.persist();
  }

  private findComponent(componentId: string): LoanComponent {
    const component = this.state.loanCases.flatMap((loan) => loan.components).find((item) => item.id === componentId);
    if (!component) throw new Error("COMPONENT_NOT_FOUND");
    return component;
  }

  async addRatePeriod(componentId: string, input: { effectiveDate: string; annualRate: string }): Promise<RatePeriod> {
    await this.ensureLoaded();
    const component = this.findComponent(componentId);
    if (component.ratePeriods.some((period) => period.effectiveDate === input.effectiveDate)) throw new Error("DUPLICATE_RATE_DATE");
    const ratePeriod: RatePeriod = { id: randomUUID(), componentId, effectiveDate: input.effectiveDate, annualRate: input.annualRate, createdAt: nowIso() };
    component.ratePeriods.push(ratePeriod);
    component.ratePeriods.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    component.updatedAt = nowIso();
    await this.persist();
    return structuredClone(ratePeriod);
  }

  async updateRatePeriod(id: string, input: { effectiveDate: string; annualRate: string }): Promise<RatePeriod> {
    await this.ensureLoaded();
    const component = this.state.loanCases.flatMap((loan) => loan.components).find((item) => item.ratePeriods.some((period) => period.id === id));
    if (!component) throw new Error("RATE_PERIOD_NOT_FOUND");
    const ratePeriod = component.ratePeriods.find((period) => period.id === id)!;
    if (component.ratePeriods.some((period) => period.id !== id && period.effectiveDate === input.effectiveDate)) throw new Error("DUPLICATE_RATE_DATE");
    ratePeriod.effectiveDate = input.effectiveDate;
    ratePeriod.annualRate = input.annualRate;
    component.ratePeriods.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    component.updatedAt = nowIso();
    await this.persist();
    return structuredClone(ratePeriod);
  }

  async deleteRatePeriod(id: string): Promise<void> {
    await this.ensureLoaded();
    const component = this.state.loanCases.flatMap((loan) => loan.components).find((item) => item.ratePeriods.some((period) => period.id === id));
    if (!component) throw new Error("RATE_PERIOD_NOT_FOUND");
    if (component.ratePeriods.length <= 1) throw new Error("CANNOT_DELETE_INITIAL_RATE");
    component.ratePeriods = component.ratePeriods.filter((period) => period.id !== id);
    await this.persist();
  }

  async saveScenario(input: Omit<SavedScenario, "createdAt"> & { createdAt?: string }): Promise<SavedScenario> {
    await this.ensureLoaded();
    const scenario = { ...input, createdAt: input.createdAt ?? nowIso() };
    this.state.scenarios = [...this.state.scenarios, scenario];
    for (const allocation of input.inputSnapshotJson.components) {
      this.state.allocations.push({ id: randomUUID(), scenarioId: scenario.id, componentId: allocation.componentId, amount: allocation.amount, interestAmount: allocation.interestAmount ?? "0.00" });
    }
    await this.persist();
    return structuredClone(scenario);
  }

  async listScenarios(loanCaseId: string): Promise<SavedScenario[]> {
    await this.ensureLoaded();
    return structuredClone(this.state.scenarios.filter((scenario) => scenario.loanCaseId === loanCaseId));
  }

  async getScenario(id: string): Promise<SavedScenario | null> {
    await this.ensureLoaded();
    const scenario = this.state.scenarios.find((item) => item.id === id);
    return scenario ? structuredClone(scenario) : null;
  }

  async deleteScenario(id: string): Promise<void> {
    await this.ensureLoaded();
    this.state.scenarios = this.state.scenarios.filter((scenario) => scenario.id !== id);
    this.state.allocations = this.state.allocations.filter((allocation) => allocation.scenarioId !== id);
    await this.persist();
  }

  async exportBackup(): Promise<BackupData> {
    await this.ensureLoaded();
    const loanCases = structuredClone(this.state.loanCases);
    return {
      loanCases,
      loanComponents: loanCases.flatMap((loan) => loan.components),
      ratePeriods: loanCases.flatMap((loan) => loan.components.flatMap((component) => component.ratePeriods)),
      prepaymentScenarios: structuredClone(this.state.scenarios),
      prepaymentAllocations: structuredClone(this.state.allocations)
    };
  }

  async replaceBusinessData(data: BackupData): Promise<void> {
    await this.ensureLoaded();
    this.state.loanCases = structuredClone(data.loanCases);
    this.state.scenarios = structuredClone(data.prepaymentScenarios);
    this.state.allocations = structuredClone(data.prepaymentAllocations);
    await this.persist();
  }
}
