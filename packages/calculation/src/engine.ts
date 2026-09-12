import Decimal from "decimal.js";
import { addMonthsFromAnchor, assertDate, compareDate } from "./date.js";
import type {
  ComponentInput,
  ComponentSchedule,
  LoanSchedule,
  PrepaymentEvent,
  ScheduleMetrics,
  ScheduleRow,
  RatePeriodInput
} from "./types.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

const ZERO = new Decimal(0);
const ONE = new Decimal(1);
const TWELVE = new Decimal(12);

function money(value: Decimal.Value): Decimal {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function rate(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

function positiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer`);
}

function validateRatePeriods(component: ComponentInput): RatePeriodInput[] {
  if (component.ratePeriods.length === 0) throw new Error("at least one rate period is required");
  const periods = [...component.ratePeriods].sort((a, b) => compareDate(a.effectiveDate, b.effectiveDate));
  const seen = new Set<string>();
  for (const period of periods) {
    assertDate(period.effectiveDate, "rate effective date");
    const annualRate = rate(period.annualRate);
    if (annualRate.isNegative()) throw new Error("annual rate cannot be negative");
    if (seen.has(period.effectiveDate)) throw new Error("duplicate rate effective date");
    seen.add(period.effectiveDate);
  }
  return periods;
}

function monthlyPayment(principal: Decimal, monthlyRate: Decimal, periods: number): Decimal {
  if (periods <= 0 || principal.lte(0)) return ZERO;
  if (monthlyRate.eq(0)) return money(principal.div(periods));
  const factor = ONE.plus(monthlyRate).pow(periods);
  return money(principal.mul(monthlyRate).mul(factor).div(factor.minus(ONE)));
}

function activeRateForPayment(
  periods: RatePeriodInput[],
  paymentDates: string[],
  paymentIndex: number,
  firstPaymentDate: string
): RatePeriodInput {
  let active = periods[0];
  if (!active) throw new Error("initial rate period is missing");
  for (let periodIndex = 1; periodIndex < periods.length; periodIndex += 1) {
    const candidate = periods[periodIndex]!;
    const boundaryIndex = paymentDates.findIndex((date) => date >= candidate.effectiveDate);
    if (boundaryIndex >= 0 && paymentIndex > boundaryIndex) active = candidate;
  }
  return active;
}

function cloneRow(row: ScheduleRow): ScheduleRow {
  return { ...row };
}

function buildMetrics(rows: ScheduleRow[], originalPrincipal: Decimal, asOf: string): ScheduleMetrics {
  const dueRows = rows.filter((row) => row.paymentDate <= asOf);
  const futureRows = rows.filter((row) => row.paymentDate > asOf);
  const remainingPrincipal = dueRows.length > 0 ? dueRows[dueRows.length - 1]!.endingPrincipal : money(originalPrincipal);
  const paidPrincipal = dueRows.reduce((sum, row) => sum.plus(row.principal), ZERO);
  const paidInterest = dueRows.reduce((sum, row) => sum.plus(row.interest), ZERO);
  const remainingInterest = futureRows.reduce((sum, row) => sum.plus(row.interest), ZERO);
  const totalInterest = rows.reduce((sum, row) => sum.plus(row.interest), ZERO);
  const next = futureRows[0];
  return {
    originalPrincipal: money(originalPrincipal).toFixed(2),
    remainingPrincipal: money(remainingPrincipal).toFixed(2),
    paidPrincipal: money(paidPrincipal).toFixed(2),
    paidInterest: money(paidInterest).toFixed(2),
    remainingInterest: money(remainingInterest).toFixed(2),
    totalInterest: money(totalInterest).toFixed(2),
    remainingPeriods: futureRows.length,
    payoffDate: rows.length > 0 ? rows[rows.length - 1]!.paymentDate : null,
    nextPayment: next?.payment ?? "0.00",
    nextPaymentDate: next?.paymentDate ?? null
  };
}

function normalizeComponent(component: ComponentInput): ComponentInput {
  assertDate(component.disbursementDate, "disbursement date");
  assertDate(component.firstPaymentDate, "first payment date");
  positiveInteger(component.termMonths, "term months");
  const principal = money(component.principal);
  if (principal.lte(0)) throw new Error("principal must be greater than zero");
  if (component.firstPaymentDate < component.disbursementDate) {
    throw new Error("first payment date cannot be before disbursement date");
  }
  return { ...component, principal: principal.toFixed(2), ratePeriods: validateRatePeriods(component) };
}

function generateBaseRows(component: ComponentInput): ScheduleRow[] {
  const normalized = normalizeComponent(component);
  const rows: ScheduleRow[] = [];
  const paymentDates = Array.from({ length: normalized.termMonths }, (_, index) =>
    addMonthsFromAnchor(normalized.firstPaymentDate, index)
  );
  let balance = money(normalized.principal);
  let segmentIndex = 0;
  let period = 1;
  let segmentRatePeriod = activeRateForPayment(normalized.ratePeriods, paymentDates, 0, normalized.firstPaymentDate);
  let remainingPeriods = normalized.termMonths;
  let fixedPayment = monthlyPayment(balance, rate(segmentRatePeriod.annualRate).div(TWELVE), remainingPeriods);
  let fixedPrincipal = money(balance.div(remainingPeriods));

  while (balance.gt(0) && period <= normalized.termMonths + normalized.ratePeriods.length + 2) {
    const paymentIndex = period - 1;
    const paymentDate = paymentDates[paymentIndex] ?? addMonthsFromAnchor(normalized.firstPaymentDate, paymentIndex);
    const ratePeriod = activeRateForPayment(normalized.ratePeriods, paymentDates, paymentIndex, normalized.firstPaymentDate);
    if (ratePeriod.effectiveDate !== segmentRatePeriod.effectiveDate) {
      segmentIndex += 1;
      segmentRatePeriod = ratePeriod;
      remainingPeriods = normalized.termMonths - period + 1;
      fixedPayment = monthlyPayment(balance, rate(ratePeriod.annualRate).div(TWELVE), remainingPeriods);
      fixedPrincipal = money(balance.div(remainingPeriods));
    }
    const monthlyRate = rate(segmentRatePeriod.annualRate).div(TWELVE);
    const openingPrincipal = money(balance);
    const interest = money(openingPrincipal.mul(monthlyRate));
    let principal = normalized.repaymentMethod === "equal_payment"
      ? money(fixedPayment.minus(interest))
      : fixedPrincipal;
    if (principal.lte(0) && openingPrincipal.gt(0)) principal = openingPrincipal;
    if (principal.gte(openingPrincipal)) principal = openingPrincipal;
    if (period >= normalized.termMonths) principal = openingPrincipal;
    const payment = money(principal.plus(interest));
    const endingPrincipal = money(openingPrincipal.minus(principal));
    const row: ScheduleRow = {
      period,
      paymentDate,
      openingPrincipal: openingPrincipal.toFixed(2),
      payment: payment.toFixed(2),
      principal: principal.toFixed(2),
      interest: interest.toFixed(2),
      annualRate: ratePeriod.annualRate,
      endingPrincipal: endingPrincipal.toFixed(2),
      segmentIndex
    };
    if (ratePeriod.id) row.ratePeriodId = ratePeriod.id;
    rows.push(row);
    balance = endingPrincipal;
    remainingPeriods -= 1;
    if (balance.lte(0)) break;
    period += 1;
  }
  return rows.map(cloneRow);
}

function addPrepaymentToRows(
  component: ComponentInput,
  baseRows: ScheduleRow[],
  event: PrepaymentEvent,
  asOf: string
): ScheduleRow[] {
  const allocation = event.allocations.find((item) => item.componentId === component.id);
  if (!allocation) return baseRows;
  const amount = money(allocation.amount);
  const interestAmount = money(allocation.interestAmount ?? "0");
  if (amount.isNegative()) throw new Error("prepayment amount cannot be negative");
  if (interestAmount.isNegative()) throw new Error("prepayment interest amount cannot be negative");
  if (amount.eq(0)) return baseRows;
  const boundaryIndex = baseRows.findIndex((row) => row.paymentDate >= event.date);
  if (boundaryIndex < 0) throw new Error("prepayment date is after the payoff date");
  const boundaryRow = baseRows[boundaryIndex]!;
  const balanceAfterPayment = money(boundaryRow.endingPrincipal);
  if (amount.gt(balanceAfterPayment)) throw new Error("prepayment amount exceeds remaining principal");
  if (event.date > asOf && asOf > boundaryRow.paymentDate) {
    throw new Error("invalid prepayment/asOf relationship");
  }
  const before = baseRows.slice(0, boundaryIndex + 1).map(cloneRow);
  const postPrepaymentBalance = money(balanceAfterPayment.minus(amount));
  if (postPrepaymentBalance.eq(0)) return before;

  const remainingRows = baseRows.slice(boundaryIndex + 1);
  const remainingPeriods = remainingRows.length;
  if (remainingPeriods === 0) return before;
  const currentRatePeriods = component.ratePeriods;
  const originalPayment = new Decimal(boundaryRow.payment);
  let targetPeriods = remainingPeriods;
  let payment = monthlyPayment(postPrepaymentBalance, rate(boundaryRow.annualRate).div(TWELVE), targetPeriods);
  let fixedPrincipal = money(postPrepaymentBalance.div(targetPeriods));
  if (event.strategy === "reduce_term") {
    if (component.repaymentMethod === "equal_payment") {
      payment = originalPayment;
      const monthlyRate = rate(boundaryRow.annualRate).div(TWELVE);
      const rawPeriods = monthlyRate.eq(0)
        ? postPrepaymentBalance.div(payment)
        : ONE.sub(postPrepaymentBalance.mul(monthlyRate).div(payment)).ln().neg().div(ONE.plus(monthlyRate).ln());
      targetPeriods = Math.max(1, Math.ceil(rawPeriods.toNumber()));
      payment = money(payment);
    } else {
      const originalPrincipalPayment = new Decimal(
        remainingRows.find((row) => row.principal !== "0.00")?.principal ?? remainingRows[0]!.principal
      );
      targetPeriods = Math.max(1, Math.ceil(postPrepaymentBalance.div(originalPrincipalPayment).toNumber()));
      fixedPrincipal = money(postPrepaymentBalance.div(targetPeriods));
    }
  }

  const regenerated: ScheduleRow[] = [];
  let balance = postPrepaymentBalance;
  const allPaymentDates = Array.from({ length: component.termMonths }, (_, index) => addMonthsFromAnchor(component.firstPaymentDate, index));
  let segmentIndex = (before[before.length - 1]?.segmentIndex ?? 0) + 1;
  let previousRate = "";
  let remainingSegmentPeriods = targetPeriods;
  let segmentPayment = payment;
  let segmentFixedPrincipal = fixedPrincipal;
  for (let index = 0; balance.gt(0) && index < targetPeriods + component.ratePeriods.length + 2; index += 1) {
    const source = remainingRows[Math.min(index, remainingRows.length - 1)]!;
    const paymentDate = source.paymentDate;
    const absolutePaymentIndex = allPaymentDates.findIndex((date) => date === paymentDate);
    const activeRatePeriod = activeRateForPayment(component.ratePeriods, allPaymentDates, Math.max(0, absolutePaymentIndex), component.firstPaymentDate);
    const currentMonthlyRate = rate(activeRatePeriod.annualRate).div(TWELVE);
    if (activeRatePeriod.effectiveDate !== previousRate) {
      const isFirstRegeneratedSegment = previousRate === "";
      if (!isFirstRegeneratedSegment) segmentIndex += 1;
      remainingSegmentPeriods = Math.max(1, targetPeriods - index);
      const keepPrepaymentPayment = isFirstRegeneratedSegment && activeRatePeriod.annualRate === boundaryRow.annualRate && event.strategy === "reduce_term" && component.repaymentMethod === "equal_payment";
      previousRate = activeRatePeriod.effectiveDate;
      segmentPayment = keepPrepaymentPayment
        ? payment
        : monthlyPayment(balance, currentMonthlyRate, remainingSegmentPeriods);
      segmentFixedPrincipal = component.repaymentMethod === "equal_principal"
        ? (event.strategy === "reduce_term" ? fixedPrincipal : money(balance.div(remainingSegmentPeriods)))
        : fixedPrincipal;
    }
    const opening = money(balance);
    const interest = money(opening.mul(currentMonthlyRate));
    let principal = component.repaymentMethod === "equal_payment"
      ? money(segmentPayment.minus(interest))
      : segmentFixedPrincipal;
    if (principal.gte(opening)) principal = opening;
    if (index >= targetPeriods - 1) principal = opening;
    const linePayment = money(principal.plus(interest));
    const ending = money(opening.minus(principal));
    const row: ScheduleRow = {
      period: before.length + index + 1,
      paymentDate,
      openingPrincipal: opening.toFixed(2),
      payment: linePayment.toFixed(2),
      principal: principal.toFixed(2),
      interest: interest.toFixed(2),
      annualRate: activeRatePeriod.annualRate,
      endingPrincipal: ending.toFixed(2),
      segmentIndex
    };
    if (activeRatePeriod.id) row.ratePeriodId = activeRatePeriod.id;
    regenerated.push(row);
    balance = ending;
  }
  return [...before, ...regenerated];
}

export function generateComponentSchedule(component: ComponentInput, asOf: string, event?: PrepaymentEvent): ComponentSchedule {
  assertDate(asOf, "asOf");
  const normalized = normalizeComponent(component);
  const baseRows = generateBaseRows(normalized);
  const rows = event ? addPrepaymentToRows(normalized, baseRows, event, asOf) : baseRows;
  return { componentId: normalized.id, rows, metrics: buildMetrics(rows, new Decimal(normalized.principal), asOf) };
}

export function aggregateSchedules(components: ComponentSchedule[], asOf: string, originalPrincipal: Decimal.Value): LoanSchedule {
  assertDate(asOf, "asOf");
  const metrics = components.reduce<ScheduleMetrics>(
    (sum, item) => ({
      originalPrincipal: money(new Decimal(sum.originalPrincipal).plus(item.metrics.originalPrincipal)).toFixed(2),
      remainingPrincipal: money(new Decimal(sum.remainingPrincipal).plus(item.metrics.remainingPrincipal)).toFixed(2),
      paidPrincipal: money(new Decimal(sum.paidPrincipal).plus(item.metrics.paidPrincipal)).toFixed(2),
      paidInterest: money(new Decimal(sum.paidInterest).plus(item.metrics.paidInterest)).toFixed(2),
      remainingInterest: money(new Decimal(sum.remainingInterest).plus(item.metrics.remainingInterest)).toFixed(2),
      totalInterest: money(new Decimal(sum.totalInterest).plus(item.metrics.totalInterest)).toFixed(2),
      remainingPeriods: Math.max(sum.remainingPeriods, item.metrics.remainingPeriods),
      payoffDate: !sum.payoffDate || (item.metrics.payoffDate && item.metrics.payoffDate > sum.payoffDate) ? item.metrics.payoffDate : sum.payoffDate,
      nextPayment: money(new Decimal(sum.nextPayment).plus(item.metrics.nextPayment)).toFixed(2),
      nextPaymentDate: !sum.nextPaymentDate || (item.metrics.nextPaymentDate && item.metrics.nextPaymentDate < sum.nextPaymentDate) ? item.metrics.nextPaymentDate : sum.nextPaymentDate
    }),
    {
      originalPrincipal: "0.00",
      remainingPrincipal: "0.00",
      paidPrincipal: "0.00",
      paidInterest: "0.00",
      remainingInterest: "0.00",
      totalInterest: "0.00",
      remainingPeriods: 0,
      payoffDate: null,
      nextPayment: "0.00",
      nextPaymentDate: null
    }
  );
  metrics.originalPrincipal = money(originalPrincipal).toFixed(2);
  return { components, metrics };
}

export function generateLoanSchedule(components: ComponentInput[], asOf: string, event?: PrepaymentEvent): LoanSchedule {
  const schedules = components.map((component) => generateComponentSchedule(component, asOf, event));
  const original = schedules.reduce((sum, component) => sum.plus(component.metrics.originalPrincipal), ZERO);
  return aggregateSchedules(schedules, asOf, original);
}

export function comparePrepayment(
  components: ComponentInput[],
  asOf: string,
  event: PrepaymentEvent
) {
  const before = generateLoanSchedule(components, asOf);
  const afterComponents = components.map((component) => ({
    ...component,
    ratePeriods: component.ratePeriods.map((period) => ({ ...period }))
  }));
  const afterSchedules = afterComponents.map((component) => generateComponentSchedule(component, asOf, event));
  const after = aggregateSchedules(
    afterSchedules,
    asOf,
    afterSchedules.reduce((sum, item) => sum.plus(item.metrics.originalPrincipal), ZERO)
  );
  const beforePayment = new Decimal(before.metrics.nextPayment);
  const afterPayment = new Decimal(after.metrics.nextPayment);
  const prepaymentInterest = money(event.allocations.reduce(
    (sum, allocation) => sum.plus(money(allocation.interestAmount ?? "0")),
    ZERO
  ));
  const totalInterestSaved = money(new Decimal(before.metrics.totalInterest).minus(after.metrics.totalInterest));
  return {
    before,
    after,
    savedInterest: money(new Decimal(before.metrics.remainingInterest).minus(after.metrics.remainingInterest)).toFixed(2),
    totalInterestSaved: totalInterestSaved.toFixed(2),
    prepaymentInterest: prepaymentInterest.toFixed(2),
    netSavedInterest: money(totalInterestSaved.minus(prepaymentInterest)).toFixed(2),
    savedPeriods: before.metrics.remainingPeriods - after.metrics.remainingPeriods,
    firstPaymentReduction: money(beforePayment.minus(afterPayment)).toFixed(2),
    prepaymentDate: event.date,
    strategy: event.strategy
  };
}
