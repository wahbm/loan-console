import { z } from "zod";

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期必须使用 YYYY-MM-DD");
export const decimalStringSchema = z.string().regex(/^\d+(\.\d{1,8})?$/, "必须是非负数字");
export const repaymentMethodSchema = z.enum(["equal_payment", "equal_principal"]);
export const componentTypeSchema = z.enum(["commercial", "provident_fund"]);

export const loanInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  notes: z.string().max(2000).optional().default(""),
  components: z.array(z.object({
    componentType: componentTypeSchema,
    principal: decimalStringSchema,
    disbursementDate: dateSchema,
    firstPaymentDate: dateSchema,
    termMonths: z.number().int().positive().max(600),
    repaymentMethod: repaymentMethodSchema,
    initialRate: decimalStringSchema
  })).min(1).max(2)
}).superRefine((value, context) => {
  const types = value.components.map((component) => component.componentType);
  if (new Set(types).size !== types.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["components"], message: "同一贷款组合不能重复添加同类分项" });
  }
});

export const prepaymentInputSchema = z.object({
  date: dateSchema,
  strategy: z.enum(["reduce_term", "reduce_payment"]),
  components: z.array(z.object({
    componentId: z.string().min(1),
    amount: decimalStringSchema,
    interestAmount: decimalStringSchema.optional().default("0.00")
  })).min(1)
});

export const ratePeriodInputSchema = z.object({
  effectiveDate: dateSchema,
  annualRate: decimalStringSchema
});

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(256)
});

export const backupSchema = z.object({
  format: z.literal("loan-console-backup"),
  schemaVersion: z.number().int().positive(),
  calculationVersion: z.string().min(1),
  exportedAt: z.string().min(1),
  appVersion: z.string().min(1),
  data: z.object({
    loanCases: z.array(z.unknown()),
    loanComponents: z.array(z.unknown()),
    ratePeriods: z.array(z.unknown()),
    prepaymentScenarios: z.array(z.unknown()).default([]),
    prepaymentAllocations: z.array(z.unknown()).default([])
  })
});
