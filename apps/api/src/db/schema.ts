import { relations } from "drizzle-orm";
import {
  date,
  datetime,
  decimal,
  index,
  int,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: varchar("id", { length: 36 }).primaryKey(),
  username: varchar("username", { length: 120 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: datetime("created_at", { mode: "string" }).notNull(),
  updatedAt: datetime("updated_at", { mode: "string" }).notNull()
}, (table) => ({ usernameUnique: uniqueIndex("users_username_unique").on(table.username) }));

export const authSessions = mysqlTable("auth_sessions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  sessionTokenHash: varchar("session_token_hash", { length: 128 }).notNull(),
  expiresAt: datetime("expires_at", { mode: "string" }).notNull(),
  lastSeenAt: datetime("last_seen_at", { mode: "string" }).notNull(),
  createdAt: datetime("created_at", { mode: "string" }).notNull()
}, (table) => ({ tokenUnique: uniqueIndex("sessions_token_unique").on(table.sessionTokenHash), userIndex: index("sessions_user_index").on(table.userId) }));

export const loanCases = mysqlTable("loan_cases", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  notes: text("notes").notNull(),
  createdAt: datetime("created_at", { mode: "string" }).notNull(),
  updatedAt: datetime("updated_at", { mode: "string" }).notNull()
});

export const loanComponents = mysqlTable("loan_components", {
  id: varchar("id", { length: 36 }).primaryKey(),
  loanCaseId: varchar("loan_case_id", { length: 36 }).notNull(),
  componentType: varchar("component_type", { length: 32 }).notNull(),
  principal: decimal("principal", { precision: 18, scale: 2 }).notNull(),
  disbursementDate: date("disbursement_date", { mode: "string" }).notNull(),
  firstPaymentDate: date("first_payment_date", { mode: "string" }).notNull(),
  termMonths: int("term_months").notNull(),
  repaymentMethod: varchar("repayment_method", { length: 32 }).notNull(),
  createdAt: datetime("created_at", { mode: "string" }).notNull(),
  updatedAt: datetime("updated_at", { mode: "string" }).notNull()
}, (table) => ({ componentUnique: uniqueIndex("loan_component_type_unique").on(table.loanCaseId, table.componentType), loanIndex: index("loan_components_loan_index").on(table.loanCaseId) }));

export const ratePeriods = mysqlTable("rate_periods", {
  id: varchar("id", { length: 36 }).primaryKey(),
  componentId: varchar("component_id", { length: 36 }).notNull(),
  effectiveDate: date("effective_date", { mode: "string" }).notNull(),
  annualRate: decimal("annual_rate", { precision: 12, scale: 8 }).notNull(),
  createdAt: datetime("created_at", { mode: "string" }).notNull()
}, (table) => ({ rateUnique: uniqueIndex("rate_period_component_date_unique").on(table.componentId, table.effectiveDate), componentIndex: index("rate_period_component_index").on(table.componentId) }));

export const prepaymentScenarios = mysqlTable("prepayment_scenarios", {
  id: varchar("id", { length: 36 }).primaryKey(),
  loanCaseId: varchar("loan_case_id", { length: 36 }).notNull(),
  prepaymentDate: date("prepayment_date", { mode: "string" }).notNull(),
  strategy: varchar("strategy", { length: 32 }).notNull(),
  inputSnapshotJson: json("input_snapshot_json").notNull(),
  resultSnapshotJson: json("result_snapshot_json").notNull(),
  calculationVersion: varchar("calculation_version", { length: 16 }).notNull(),
  createdAt: datetime("created_at", { mode: "string" }).notNull()
}, (table) => ({ scenarioIndex: index("prepayment_scenario_loan_index").on(table.loanCaseId) }));

export const prepaymentAllocations = mysqlTable("prepayment_allocations", {
  id: varchar("id", { length: 36 }).primaryKey(),
  scenarioId: varchar("scenario_id", { length: 36 }).notNull(),
  componentId: varchar("component_id", { length: 36 }).notNull(),
  amount: decimal("amount", { precision: 18, scale: 2 }).notNull()
}, (table) => ({ allocationUnique: uniqueIndex("prepayment_allocation_unique").on(table.scenarioId, table.componentId) }));

export const userRelations = relations(users, ({ many }) => ({ sessions: many(authSessions) }));
export const sessionRelations = relations(authSessions, ({ one }) => ({ user: one(users, { fields: [authSessions.userId], references: [users.id] }) }));
export const loanCaseRelations = relations(loanCases, ({ many }) => ({ components: many(loanComponents), scenarios: many(prepaymentScenarios) }));
export const componentRelations = relations(loanComponents, ({ one, many }) => ({ loanCase: one(loanCases, { fields: [loanComponents.loanCaseId], references: [loanCases.id] }), rates: many(ratePeriods), allocations: many(prepaymentAllocations) }));
export const rateRelations = relations(ratePeriods, ({ one }) => ({ component: one(loanComponents, { fields: [ratePeriods.componentId], references: [loanComponents.id] }) }));
export const scenarioRelations = relations(prepaymentScenarios, ({ one, many }) => ({ loanCase: one(loanCases, { fields: [prepaymentScenarios.loanCaseId], references: [loanCases.id] }), allocations: many(prepaymentAllocations) }));
export const allocationRelations = relations(prepaymentAllocations, ({ one }) => ({ scenario: one(prepaymentScenarios, { fields: [prepaymentAllocations.scenarioId], references: [prepaymentScenarios.id] }), component: one(loanComponents, { fields: [prepaymentAllocations.componentId], references: [loanComponents.id] }) }));
