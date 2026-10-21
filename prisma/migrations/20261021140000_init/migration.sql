-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "debt_type" AS ENUM ('credit_card', 'personal_loan', 'vehicle', 'home', 'other');

-- CreateEnum
CREATE TYPE "goal_type" AS ENUM ('home', 'car', 'other');

-- CreateEnum
CREATE TYPE "consent_type" AS ENUM ('privacy_notice', 'open_banking', 'ai_processing', 'marketing');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "privacy_consent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_profiles" (
    "user_id" UUID NOT NULL,
    "gross_monthly_income" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "take_home_income" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "essential_expenses" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "monthly_buffer" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "debt_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "debt_type" "debt_type" NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL,
    "monthly_payment" DECIMAL(14,2) NOT NULL,
    "annual_rate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debt_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "debt_account_id" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" VARCHAR(250) NOT NULL DEFAULT '',
    "paid_at" TIMESTAMPTZ(6) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "goal_type" "goal_type" NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "target_amount" DECIMAL(14,2) NOT NULL,
    "deposit_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "target_date" DATE,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "payment_reminders_enabled" BOOLEAN NOT NULL DEFAULT false,
    "goal_updates_enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "consent_type" "consent_type" NOT NULL,
    "policy_version" VARCHAR(40) NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawn_at" TIMESTAMPTZ(6),

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "debt_accounts_user_id_idx" ON "debt_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "debt_accounts_id_user_id_key" ON "debt_accounts"("id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "debt_accounts_user_id_idempotency_key_key" ON "debt_accounts"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "payments_user_id_paid_at_idx" ON "payments"("user_id", "paid_at" DESC);

-- CreateIndex
CREATE INDEX "payments_debt_account_id_idx" ON "payments"("debt_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_user_id_idempotency_key_key" ON "payments"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "goals_user_id_idx" ON "goals"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "goals_user_id_idempotency_key_key" ON "goals"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "consent_records_user_id_consent_type_idx" ON "consent_records"("user_id", "consent_type");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_profiles" ADD CONSTRAINT "financial_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_accounts" ADD CONSTRAINT "debt_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_debt_account_id_user_id_fkey" FOREIGN KEY ("debt_account_id", "user_id") REFERENCES "debt_accounts"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "financial_profiles"
ADD CONSTRAINT "financial_profiles_nonnegative_amounts"
CHECK (
  "gross_monthly_income" >= 0 AND
  "take_home_income" >= 0 AND
  "essential_expenses" >= 0 AND
  "monthly_buffer" >= 0
);

ALTER TABLE "debt_accounts"
ADD CONSTRAINT "debt_accounts_nonnegative_amounts"
CHECK (
  "balance" >= 0 AND
  "monthly_payment" >= 0 AND
  "annual_rate" >= 0 AND
  "annual_rate" <= 100
);

ALTER TABLE "payments"
ADD CONSTRAINT "payments_positive_amount"
CHECK ("amount" > 0);

ALTER TABLE "goals"
ADD CONSTRAINT "goals_valid_amounts"
CHECK (
  "target_amount" > 0 AND
  "deposit_amount" >= 0 AND
  "deposit_amount" <= "target_amount"
);
