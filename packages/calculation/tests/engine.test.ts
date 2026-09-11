import { describe, expect, it } from "vitest";
import {
  addMonthsFromAnchor,
  comparePrepayment,
  generateComponentSchedule,
  generateLoanSchedule,
  type ComponentInput
} from "../src/index.js";

const equalPaymentComponent: ComponentInput = {
  id: "commercial",
  principal: "100000.00",
  disbursementDate: "2026-01-01",
  firstPaymentDate: "2026-01-31",
  termMonths: 12,
  repaymentMethod: "equal_payment",
  ratePeriods: [{ effectiveDate: "2026-01-01", annualRate: "0.03600000" }]
};

describe("date anchors", () => {
  it("keeps month-end anchors", () => {
    expect(addMonthsFromAnchor("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsFromAnchor("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonthsFromAnchor("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("keeps non-month-end day when possible", () => {
    expect(addMonthsFromAnchor("2026-01-30", 1)).toBe("2026-02-28");
    expect(addMonthsFromAnchor("2026-01-30", 2)).toBe("2026-03-30");
  });
});

describe("loan schedule engine", () => {
  it("generates equal payment rows and closes at zero", () => {
    const schedule = generateComponentSchedule(equalPaymentComponent, "2026-01-01");
    expect(schedule.rows).toHaveLength(12);
    expect(schedule.rows[0]?.payment).toBe("8496.73");
    expect(schedule.rows.at(-1)?.endingPrincipal).toBe("0.00");
    expect(schedule.metrics.totalInterest).toBe("1960.71");
  });

  it("supports zero interest", () => {
    const schedule = generateComponentSchedule({
      ...equalPaymentComponent,
      ratePeriods: [{ effectiveDate: "2026-01-01", annualRate: "0" }]
    }, "2026-01-01");
    expect(schedule.rows[0]?.payment).toBe("8333.33");
    expect(schedule.rows.at(-1)?.principal).toBe("8333.37");
    expect(schedule.rows.at(-1)?.endingPrincipal).toBe("0.00");
  });

  it("supports equal principal", () => {
    const schedule = generateComponentSchedule({
      ...equalPaymentComponent,
      repaymentMethod: "equal_principal"
    }, "2026-01-01");
    expect(schedule.rows[0]?.principal).toBe("8333.33");
    expect(schedule.rows.at(-1)?.endingPrincipal).toBe("0.00");
    expect(Number(schedule.rows[0]?.payment)).toBeGreaterThan(Number(schedule.rows.at(-1)?.payment));
  });

  it("uses the new rate after the mapped boundary", () => {
    const schedule = generateComponentSchedule({
      ...equalPaymentComponent,
      ratePeriods: [
        { effectiveDate: "2026-01-01", annualRate: "0.03600000" },
        { effectiveDate: "2026-06-10", annualRate: "0.02400000" }
      ]
    }, "2026-01-01");
    expect(schedule.rows.find((row) => row.paymentDate === "2026-06-30")?.annualRate).toBe("0.03600000");
    expect(schedule.rows.find((row) => row.paymentDate === "2026-07-31")?.annualRate).toBe("0.02400000");
  });

  it("calculates paid and remaining interest by asOf", () => {
    const schedule = generateComponentSchedule(equalPaymentComponent, "2026-06-30");
    expect(schedule.metrics.paidInterest).toBe("1429.68");
    expect(schedule.metrics.remainingPeriods).toBe(6);
  });

  it("compares a prepayment without changing the original schedule", () => {
    const comparison = comparePrepayment([equalPaymentComponent], "2026-06-30", {
      date: "2026-07-15",
      strategy: "reduce_payment",
      allocations: [{ componentId: "commercial", amount: "20000.00" }]
    });
    expect(Number(comparison.after.metrics.remainingInterest)).toBeLessThan(Number(comparison.before.metrics.remainingInterest));
    expect(Number(comparison.savedInterest)).toBeGreaterThan(0);
    expect(comparison.before.components[0]?.rows).not.toEqual(comparison.after.components[0]?.rows);
  });

  it("aggregates mixed components", () => {
    const result = generateLoanSchedule([
      equalPaymentComponent,
      {
        ...equalPaymentComponent,
        id: "provident",
        principal: "50000.00",
        termMonths: 24,
        firstPaymentDate: "2026-02-15",
        ratePeriods: [{ effectiveDate: "2026-01-01", annualRate: "0.02750000" }]
      }
    ], "2026-06-30");
    expect(result.components).toHaveLength(2);
    expect(result.metrics.originalPrincipal).toBe("150000.00");
    expect(result.metrics.nextPaymentDate).toBe("2026-07-15");
  });
});
