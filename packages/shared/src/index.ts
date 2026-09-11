import type {
  ComponentInput,
  LoanSchedule,
  PrepaymentComparison,
  PrepaymentStrategy,
  RepaymentMethod,
  ScheduleRow
} from "@loan-console/calculation";

export type { RepaymentMethod } from "@loan-console/calculation";

export type ComponentType = "commercial" | "provident_fund";

export type RatePeriod = {
  id: string;
  componentId: string;
  effectiveDate: string;
  annualRate: string;
  createdAt: string;
};

export type LoanComponent = Omit<ComponentInput, "ratePeriods"> & {
  loanCaseId: string;
  componentType: ComponentType;
  ratePeriods: RatePeriod[];
  createdAt: string;
  updatedAt: string;
};

export type LoanCase = {
  id: string;
  name: string;
  notes: string;
  components: LoanComponent[];
  createdAt: string;
  updatedAt: string;
};

export type LoanCaseInput = {
  name: string;
  notes?: string;
  components: Array<{
    componentType: ComponentType;
    principal: string;
    disbursementDate: string;
    firstPaymentDate: string;
    termMonths: number;
    repaymentMethod: RepaymentMethod;
    initialRate: string;
  }>;
};

export type PrepaymentInput = {
  date: string;
  strategy: PrepaymentStrategy;
  components: Array<{ componentId: string; amount: string }>;
};

export type ScheduleResponse = {
  loanCase: LoanCase;
  schedule: LoanSchedule;
  componentRows: Record<string, ScheduleRow[]>;
  asOf: string;
};

export type PrepaymentResponse = PrepaymentComparison;

export type DashboardSummary = {
  asOf: string;
  loans: Array<{
    id: string;
    name: string;
    originalPrincipal: string;
    remainingPrincipal: string;
    nextPayment: string;
    nextPaymentDate: string | null;
    remainingInterest: string;
    payoffDate: string | null;
  }>;
  totals: LoanSchedule["metrics"];
  byComponentType: Record<ComponentType, string>;
};

export type ApiError = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type AuthUser = {
  id: string;
  username: string;
};

export type AuthResponse = {
  user: AuthUser;
};
