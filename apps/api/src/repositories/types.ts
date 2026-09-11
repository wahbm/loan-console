import type { DashboardSummary, LoanCase, LoanCaseInput, LoanComponent, PrepaymentInput, RatePeriod } from "@loan-console/shared";
import type { PrepaymentComparison } from "@loan-console/calculation";

export type UserRecord = {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionRecord = {
  id: string;
  userId: string;
  sessionTokenHash: string;
  expiresAt: string;
  lastSeenAt: string;
  createdAt: string;
};

export type SavedScenario = {
  id: string;
  loanCaseId: string;
  prepaymentDate: string;
  strategy: PrepaymentInput["strategy"];
  inputSnapshotJson: PrepaymentInput;
  resultSnapshotJson: PrepaymentComparison;
  calculationVersion: string;
  createdAt: string;
};

export type BackupData = {
  loanCases: LoanCase[];
  loanComponents: LoanComponent[];
  ratePeriods: RatePeriod[];
  prepaymentScenarios: SavedScenario[];
  prepaymentAllocations: Array<{ id: string; scenarioId: string; componentId: string; amount: string }>;
};

export interface Repository {
  findUserByUsername(username: string): Promise<UserRecord | null>;
  findUserById(userId: string): Promise<UserRecord | null>;
  createUser(input: { username: string; passwordHash: string }): Promise<UserRecord>;
  updateUserPassword(userId: string, passwordHash: string): Promise<void>;
  deleteSessionsForUser(userId: string): Promise<void>;
  createSession(input: Omit<SessionRecord, "createdAt"> & { createdAt?: string }): Promise<SessionRecord>;
  findSessionByHash(sessionTokenHash: string): Promise<SessionRecord | null>;
  touchSession(sessionId: string, lastSeenAt: string, expiresAt: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;

  listLoanCases(): Promise<LoanCase[]>;
  getLoanCase(id: string): Promise<LoanCase | null>;
  createLoanCase(input: LoanCaseInput): Promise<LoanCase>;
  updateLoanCase(id: string, input: Partial<Pick<LoanCaseInput, "name" | "notes">>): Promise<LoanCase>;
  deleteLoanCase(id: string): Promise<void>;
  addRatePeriod(componentId: string, input: { effectiveDate: string; annualRate: string }): Promise<RatePeriod>;
  updateRatePeriod(id: string, input: { effectiveDate: string; annualRate: string }): Promise<RatePeriod>;
  deleteRatePeriod(id: string): Promise<void>;

  saveScenario(input: Omit<SavedScenario, "createdAt"> & { createdAt?: string }): Promise<SavedScenario>;
  listScenarios(loanCaseId: string): Promise<SavedScenario[]>;
  getScenario(id: string): Promise<SavedScenario | null>;
  deleteScenario(id: string): Promise<void>;

  exportBackup(): Promise<BackupData>;
  replaceBusinessData(data: BackupData): Promise<void>;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function nowSql(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}
