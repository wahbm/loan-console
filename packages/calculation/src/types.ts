export type RepaymentMethod = "equal_payment" | "equal_principal";

export type RatePeriodInput = {
  id?: string;
  effectiveDate: string;
  annualRate: string;
};

export type ComponentInput = {
  id: string;
  principal: string;
  disbursementDate: string;
  firstPaymentDate: string;
  termMonths: number;
  repaymentMethod: RepaymentMethod;
  ratePeriods: RatePeriodInput[];
};

export type PrepaymentStrategy = "reduce_term" | "reduce_payment";

export type PrepaymentAllocation = {
  componentId: string;
  /** Principal reduction only. */
  amount: string;
  /** Bank-settled accrued interest paid with the prepayment; it does not reduce principal. */
  interestAmount?: string;
};

export type PrepaymentEvent = {
  date: string;
  strategy: PrepaymentStrategy;
  allocations: PrepaymentAllocation[];
};

export type ScheduleRow = {
  period: number;
  paymentDate: string;
  openingPrincipal: string;
  payment: string;
  principal: string;
  interest: string;
  annualRate: string;
  endingPrincipal: string;
  ratePeriodId?: string;
  segmentIndex: number;
};

export type ScheduleMetrics = {
  originalPrincipal: string;
  remainingPrincipal: string;
  paidPrincipal: string;
  paidInterest: string;
  remainingInterest: string;
  totalInterest: string;
  remainingPeriods: number;
  payoffDate: string | null;
  nextPayment: string;
  nextPaymentDate: string | null;
};

export type ComponentSchedule = {
  componentId: string;
  rows: ScheduleRow[];
  metrics: ScheduleMetrics;
};

export type LoanSchedule = {
  components: ComponentSchedule[];
  metrics: ScheduleMetrics;
};

export type PrepaymentComparison = {
  before: LoanSchedule;
  after: LoanSchedule;
  savedInterest: string;
  totalInterestSaved: string;
  prepaymentInterest: string;
  netSavedInterest: string;
  savedPeriods: number;
  firstPaymentReduction: string;
  prepaymentDate: string;
  strategy: PrepaymentStrategy;
};
