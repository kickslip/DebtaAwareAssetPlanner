CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  privacy_consent_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS financial_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  gross_monthly_income NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (gross_monthly_income >= 0),
  take_home_income NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (take_home_income >= 0),
  essential_expenses NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (essential_expenses >= 0),
  monthly_buffer NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (monthly_buffer >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS debt_accounts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  debt_type TEXT NOT NULL CHECK (debt_type IN ('credit_card', 'personal_loan', 'vehicle', 'home', 'other')),
  balance NUMERIC(14, 2) NOT NULL CHECK (balance >= 0),
  monthly_payment NUMERIC(14, 2) NOT NULL CHECK (monthly_payment >= 0),
  annual_rate NUMERIC(7, 4) NOT NULL DEFAULT 0 CHECK (annual_rate >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, user_id)
);

CREATE INDEX IF NOT EXISTS debt_accounts_user_id_idx ON debt_accounts(user_id);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  debt_account_id UUID,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  note TEXT NOT NULL DEFAULT '',
  paid_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (debt_account_id, user_id)
    REFERENCES debt_accounts(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS payments_user_paid_at_idx ON payments(user_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS payments_debt_account_idx ON payments(debt_account_id);

CREATE TABLE IF NOT EXISTS goals (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_type TEXT NOT NULL CHECK (goal_type IN ('home', 'car', 'other')),
  name TEXT NOT NULL,
  target_amount NUMERIC(14, 2) NOT NULL CHECK (target_amount > 0),
  deposit_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  target_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS goals_user_id_idx ON goals(user_id);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payment_reminders_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  goal_updates_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consent_records (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL CHECK (consent_type IN ('privacy_notice', 'open_banking', 'ai_processing', 'marketing')),
  policy_version TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  withdrawn_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS consent_records_user_type_idx ON consent_records(user_id, consent_type);
