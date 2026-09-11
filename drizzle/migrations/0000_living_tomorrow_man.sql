CREATE TABLE `auth_sessions` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`session_token_hash` varchar(128) NOT NULL,
	`expires_at` datetime NOT NULL,
	`last_seen_at` datetime NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `auth_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sessions_token_unique` UNIQUE(`session_token_hash`)
);
--> statement-breakpoint
CREATE TABLE `loan_cases` (
	`id` varchar(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`notes` text NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `loan_cases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `loan_components` (
	`id` varchar(36) NOT NULL,
	`loan_case_id` varchar(36) NOT NULL,
	`component_type` varchar(32) NOT NULL,
	`principal` decimal(18,2) NOT NULL,
	`disbursement_date` date NOT NULL,
	`first_payment_date` date NOT NULL,
	`term_months` int NOT NULL,
	`repayment_method` varchar(32) NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `loan_components_id` PRIMARY KEY(`id`),
	CONSTRAINT `loan_component_type_unique` UNIQUE(`loan_case_id`,`component_type`)
);
--> statement-breakpoint
CREATE TABLE `prepayment_allocations` (
	`id` varchar(36) NOT NULL,
	`scenario_id` varchar(36) NOT NULL,
	`component_id` varchar(36) NOT NULL,
	`amount` decimal(18,2) NOT NULL,
	CONSTRAINT `prepayment_allocations_id` PRIMARY KEY(`id`),
	CONSTRAINT `prepayment_allocation_unique` UNIQUE(`scenario_id`,`component_id`)
);
--> statement-breakpoint
CREATE TABLE `prepayment_scenarios` (
	`id` varchar(36) NOT NULL,
	`loan_case_id` varchar(36) NOT NULL,
	`prepayment_date` date NOT NULL,
	`strategy` varchar(32) NOT NULL,
	`input_snapshot_json` json NOT NULL,
	`result_snapshot_json` json NOT NULL,
	`calculation_version` varchar(16) NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `prepayment_scenarios_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rate_periods` (
	`id` varchar(36) NOT NULL,
	`component_id` varchar(36) NOT NULL,
	`effective_date` date NOT NULL,
	`annual_rate` decimal(12,8) NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `rate_periods_id` PRIMARY KEY(`id`),
	CONSTRAINT `rate_period_component_date_unique` UNIQUE(`component_id`,`effective_date`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`username` varchar(120) NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_username_unique` UNIQUE(`username`)
);
--> statement-breakpoint
CREATE INDEX `sessions_user_index` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `loan_components_loan_index` ON `loan_components` (`loan_case_id`);--> statement-breakpoint
CREATE INDEX `prepayment_scenario_loan_index` ON `prepayment_scenarios` (`loan_case_id`);--> statement-breakpoint
CREATE INDEX `rate_period_component_index` ON `rate_periods` (`component_id`);--> statement-breakpoint
ALTER TABLE `auth_sessions` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;--> statement-breakpoint
ALTER TABLE `loan_cases` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;--> statement-breakpoint
ALTER TABLE `loan_components` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;--> statement-breakpoint
ALTER TABLE `prepayment_allocations` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;--> statement-breakpoint
ALTER TABLE `prepayment_scenarios` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;--> statement-breakpoint
ALTER TABLE `rate_periods` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;--> statement-breakpoint
ALTER TABLE `users` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
