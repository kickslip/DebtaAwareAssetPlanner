import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { z } from "zod";
import { calculateAffordability } from "../lib/affordability.js";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  readSessionToken,
  dummyPasswordHash,
  verifyPassword,
} from "./security.js";
import { getIntegrationStatus } from "./providers/status.js";

const privacyPolicyVersion = "draft-1";
const sessionLifetimeMs =
  Math.max(1, Math.min(90, Number(process.env.SESSION_DAYS) || 30)) *
  24 *
  60 *
  60 *
  1000;
const allowedOrigins = new Set(
  [
    process.env.WEB_ORIGIN || "http://localhost:3000",
    ...(process.env.ALLOWED_ORIGINS || "").split(","),
  ]
    .map((origin) => origin.trim())
    .filter(Boolean),
);

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const emailSchema = z.string().trim().email().max(254);
const passwordSchema = z.string().min(12).max(128);
const amountSchema = z.coerce.number().finite().min(0).max(1_000_000_000);
const positiveAmountSchema = amountSchema.min(0.01);
const uuidSchema = z.string().uuid();

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  privacyConsent: z.literal(true),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

const profileSchema = z
  .object({
    grossMonthlyIncome: amountSchema,
    takeHomeIncome: amountSchema,
    essentialExpenses: amountSchema,
    monthlyBuffer: amountSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0);

const debtSchema = z.object({
  name: z.string().trim().min(1).max(80),
  debtType: z.enum(["credit_card", "personal_loan", "vehicle", "home", "other"]),
  balance: amountSchema,
  monthlyPayment: amountSchema,
  annualRate: amountSchema.max(100),
});

const paymentSchema = z.object({
  debtAccountId: uuidSchema.nullable().optional(),
  amount: positiveAmountSchema,
  note: z.string().trim().max(250).default(""),
  paidAt: z.string().datetime().optional(),
});

const goalSchema = z.object({
  goalType: z.enum(["home", "car", "other"]),
  name: z.string().trim().min(1).max(100),
  targetAmount: positiveAmountSchema,
  depositAmount: amountSchema,
  targetDate: z.string().date().nullable().optional(),
});

const negotiationSchema = z.object({
  creditorName: z.string().trim().min(1).max(80),
  proposalType: z.enum(["restructure", "consolidate"]),
  preferredMonthlyPayment: positiveAmountSchema,
  reason: z.string().trim().min(1).max(500),
});

const preferenceSchema = z
  .object({
    paymentRemindersEnabled: z.boolean(),
    goalUpdatesEnabled: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0);

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(
      400,
      "Invalid request.",
      result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

function numericRecord(record) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      value === null || value === undefined || key === "user_id"
        ? value
        : Number(value),
    ]),
  );
}

function setSessionCookie(response, token) {
  response.cookie("debtaware_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: sessionLifetimeMs,
  });
}

async function createSession(pool, userId) {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + sessionLifetimeMs);
  await pool.query(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
    [randomUUID(), userId, hashSessionToken(token), expiresAt],
  );
  return { token, expiresAt };
}

function requireAuth(pool) {
  return async (request, response, next) => {
    try {
      const token = readSessionToken(request);
      if (!token || token.length > 128) {
        throw new ApiError(401, "Sign in to continue.");
      }
      const result = await pool.query(
        `SELECT users.id, users.email
         FROM sessions
         JOIN users ON users.id = sessions.user_id
         WHERE sessions.token_hash = $1 AND sessions.expires_at > NOW()`,
        [hashSessionToken(token)],
      );
      if (!result.rowCount) throw new ApiError(401, "Sign in to continue.");
      request.auth = { ...result.rows[0], token };
      next();
    } catch (error) {
      next(error);
    }
  };
}

function createAuthLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many sign-in attempts. Try again later." },
  });
}

function createApiLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: 180,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
}

function mapDebt(row) {
  return {
    id: row.id,
    name: row.name,
    debtType: row.debt_type,
    balance: Number(row.balance),
    monthlyPayment: Number(row.monthly_payment),
    annualRate: Number(row.annual_rate),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPayment(row) {
  return {
    id: row.id,
    debtAccountId: row.debt_account_id,
    debtName: row.debt_name || null,
    amount: Number(row.amount),
    note: row.note,
    paidAt: row.paid_at,
    createdAt: row.created_at,
  };
}

export function createApp({ pool }) {
  const app = express();
  const auth = requireAuth(pool);
  const authLimiter = createAuthLimiter();
  const apiLimiter = createApiLimiter();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        callback(null, !origin || allowedOrigins.has(origin));
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Client-Platform"],
    }),
  );
  app.use((request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    const origin = request.get("origin");
    const hasBearer = request.get("authorization")?.startsWith("Bearer ");
    if (origin && !allowedOrigins.has(origin) && !hasBearer) {
      return response.status(403).json({ error: "Origin is not allowed." });
    }
    next();
  });
  app.use(express.json({ limit: "32kb", strict: true }));
  app.use("/api", apiLimiter);

  app.get("/health", async (request, response, next) => {
    try {
      await pool.query("SELECT 1");
      response.json({ status: "ok" });
    } catch (error) {
      next(error);
    }
  });

  app.post("/auth/register", authLimiter, async (request, response) => {
    const input = parse(registerSchema, request.body);
    const email = input.email.toLowerCase();
    const client = await pool.connect();
    const userId = randomUUID();

    try {
      await client.query("BEGIN");
      const user = await client.query(
        `INSERT INTO users (id, email, password_hash, privacy_consent_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id, email, created_at`,
        [userId, email, await hashPassword(input.password)],
      );
      await client.query(
        "INSERT INTO financial_profiles (user_id) VALUES ($1)",
        [userId],
      );
      await client.query(
        "INSERT INTO notification_preferences (user_id) VALUES ($1)",
        [userId],
      );
      await client.query(
        `INSERT INTO consent_records (id, user_id, consent_type, policy_version)
         VALUES ($1, $2, 'privacy_notice', $3)`,
        [randomUUID(), userId, privacyPolicyVersion],
      );
      const token = createSessionToken();
      const expiresAt = new Date(Date.now() + sessionLifetimeMs);
      await client.query(
        "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
        [randomUUID(), userId, hashSessionToken(token), expiresAt],
      );
      await client.query("COMMIT");
      setSessionCookie(response, token);
      response.status(201).json({
        user: user.rows[0],
        ...(request.get("x-client-platform") === "android"
          ? { accessToken: token }
          : {}),
      });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") {
        throw new ApiError(409, "An account with that email already exists.");
      }
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/auth/login", authLimiter, async (request, response) => {
    const input = parse(loginSchema, request.body);
    const result = await pool.query(
      "SELECT id, email, password_hash, created_at FROM users WHERE email = $1",
      [input.email.toLowerCase()],
    );
    const user = result.rows[0];
    const passwordMatches = await verifyPassword(
      input.password,
      user?.password_hash || (await dummyPasswordHash),
    );
    if (!user || !passwordMatches) {
      throw new ApiError(401, "Invalid email or password.");
    }

    const { token } = await createSession(pool, user.id);
    setSessionCookie(response, token);
    response.json({
      user: { id: user.id, email: user.email, created_at: user.created_at },
      ...(request.get("x-client-platform") === "android"
        ? { accessToken: token }
        : {}),
    });
  });

  app.post("/auth/logout", auth, async (request, response) => {
    await pool.query("DELETE FROM sessions WHERE token_hash = $1", [
      hashSessionToken(request.auth.token),
    ]);
    response.clearCookie("debtaware_session", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    response.status(204).end();
  });

  app.get("/auth/me", auth, (request, response) => {
    response.json({ user: { id: request.auth.id, email: request.auth.email } });
  });

  app.get("/api/account/export", auth, async (request, response) => {
    const [profile, debts, payments, goals, preferences, consents] =
      await Promise.all([
        pool.query(
          "SELECT * FROM financial_profiles WHERE user_id = $1",
          [request.auth.id],
        ),
        pool.query(
          "SELECT id, name, debt_type, balance, monthly_payment, annual_rate, created_at, updated_at FROM debt_accounts WHERE user_id = $1 ORDER BY created_at",
          [request.auth.id],
        ),
        pool.query(
          "SELECT id, debt_account_id, amount, note, paid_at, created_at FROM payments WHERE user_id = $1 ORDER BY paid_at",
          [request.auth.id],
        ),
        pool.query(
          "SELECT id, goal_type, name, target_amount, deposit_amount, target_date, created_at, updated_at FROM goals WHERE user_id = $1 ORDER BY created_at",
          [request.auth.id],
        ),
        pool.query(
          "SELECT payment_reminders_enabled, goal_updates_enabled, updated_at FROM notification_preferences WHERE user_id = $1",
          [request.auth.id],
        ),
        pool.query(
          "SELECT consent_type, policy_version, granted_at, withdrawn_at FROM consent_records WHERE user_id = $1 ORDER BY granted_at",
          [request.auth.id],
        ),
      ]);
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="debtaware-account-export.json"',
    );
    response.json({
      exportedAt: new Date().toISOString(),
      account: { id: request.auth.id, email: request.auth.email },
      financialProfile: profile.rows[0] || null,
      debtAccounts: debts.rows,
      payments: payments.rows,
      goals: goals.rows,
      notificationPreferences: preferences.rows[0] || null,
      consentRecords: consents.rows,
    });
  });

  app.delete("/api/account", auth, async (request, response) => {
    const input = parse(
      z.object({
        email: emailSchema,
        password: passwordSchema,
      }),
      request.body,
    );
    if (input.email.toLowerCase() !== request.auth.email) {
      throw new ApiError(403, "Email confirmation did not match.");
    }
    const user = await pool.query(
      "SELECT password_hash FROM users WHERE id = $1",
      [request.auth.id],
    );
    if (
      !user.rowCount ||
      !(await verifyPassword(input.password, user.rows[0].password_hash))
    ) {
      throw new ApiError(403, "Password confirmation failed.");
    }
    await pool.query("DELETE FROM users WHERE id = $1", [request.auth.id]);
    response.clearCookie("debtaware_session", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    response.status(204).end();
  });

  app.get("/api/profile", auth, async (request, response) => {
    const result = await pool.query(
      `SELECT gross_monthly_income, take_home_income, essential_expenses,
              monthly_buffer, updated_at
       FROM financial_profiles WHERE user_id = $1`,
      [request.auth.id],
    );
    response.json(
      result.rows[0]
        ? {
            grossMonthlyIncome: Number(result.rows[0].gross_monthly_income),
            takeHomeIncome: Number(result.rows[0].take_home_income),
            essentialExpenses: Number(result.rows[0].essential_expenses),
            monthlyBuffer: Number(result.rows[0].monthly_buffer),
            updatedAt: result.rows[0].updated_at,
          }
        : null,
    );
  });

  app.get("/api/integrations", auth, (request, response) => {
    response.json(getIntegrationStatus());
  });

  app.patch("/api/profile", auth, async (request, response) => {
    const input = parse(profileSchema, request.body);
    const columns = {
      grossMonthlyIncome: "gross_monthly_income",
      takeHomeIncome: "take_home_income",
      essentialExpenses: "essential_expenses",
      monthlyBuffer: "monthly_buffer",
    };
    const entries = Object.entries(input);
    const assignments = entries.map(
      ([key], index) => `${columns[key]} = $${index + 2}`,
    );
    const values = entries.map(([, value]) => value);
    const result = await pool.query(
      `UPDATE financial_profiles
       SET ${assignments.join(", ")}, updated_at = NOW()
       WHERE user_id = $1
       RETURNING gross_monthly_income, take_home_income,
                 essential_expenses, monthly_buffer, updated_at`,
      [request.auth.id, ...values],
    );
    response.json({
      grossMonthlyIncome: Number(result.rows[0].gross_monthly_income),
      takeHomeIncome: Number(result.rows[0].take_home_income),
      essentialExpenses: Number(result.rows[0].essential_expenses),
      monthlyBuffer: Number(result.rows[0].monthly_buffer),
      updatedAt: result.rows[0].updated_at,
    });
  });

  app.get("/api/debts", auth, async (request, response) => {
    const result = await pool.query(
      `SELECT id, name, debt_type, balance, monthly_payment, annual_rate,
              created_at, updated_at
       FROM debt_accounts WHERE user_id = $1 ORDER BY created_at`,
      [request.auth.id],
    );
    response.json(result.rows.map(mapDebt));
  });

  app.post("/api/debts", auth, async (request, response) => {
    const input = parse(debtSchema, request.body);
    const result = await pool.query(
      `INSERT INTO debt_accounts
       (id, user_id, name, debt_type, balance, monthly_payment, annual_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, debt_type, balance, monthly_payment, annual_rate,
                 created_at, updated_at`,
      [
        randomUUID(),
        request.auth.id,
        input.name,
        input.debtType,
        input.balance,
        input.monthlyPayment,
        input.annualRate,
      ],
    );
    response.status(201).json(mapDebt(result.rows[0]));
  });

  app.get("/api/payments", auth, async (request, response) => {
    const result = await pool.query(
      `SELECT payments.id, payments.debt_account_id, debt_accounts.name AS debt_name,
              payments.amount, payments.note, payments.paid_at, payments.created_at
       FROM payments
       LEFT JOIN debt_accounts ON debt_accounts.id = payments.debt_account_id
       WHERE payments.user_id = $1
       ORDER BY payments.paid_at DESC LIMIT 100`,
      [request.auth.id],
    );
    response.json(result.rows.map(mapPayment));
  });

  app.post("/api/payments", auth, async (request, response) => {
    const input = parse(paymentSchema, request.body);
    const client = await pool.connect();
    const paymentId = randomUUID();
    const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();

    try {
      await client.query("BEGIN");
      if (input.debtAccountId) {
        const debt = await client.query(
          "SELECT id FROM debt_accounts WHERE id = $1 AND user_id = $2 FOR UPDATE",
          [input.debtAccountId, request.auth.id],
        );
        if (!debt.rowCount) throw new ApiError(404, "Debt account not found.");
        await client.query(
          `UPDATE debt_accounts
           SET balance = GREATEST(0, balance - $1), updated_at = NOW()
           WHERE id = $2 AND user_id = $3`,
          [input.amount, input.debtAccountId, request.auth.id],
        );
      }
      const result = await client.query(
        `INSERT INTO payments (id, user_id, debt_account_id, amount, note, paid_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, debt_account_id, amount, note, paid_at, created_at`,
        [
          paymentId,
          request.auth.id,
          input.debtAccountId || null,
          input.amount,
          input.note,
          paidAt,
        ],
      );
      await client.query("COMMIT");
      response.status(201).json(mapPayment(result.rows[0]));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.get("/api/goals", auth, async (request, response) => {
    const result = await pool.query(
      `SELECT id, goal_type, name, target_amount, deposit_amount, target_date,
              created_at, updated_at
       FROM goals WHERE user_id = $1 ORDER BY created_at DESC`,
      [request.auth.id],
    );
    response.json(
      result.rows.map((row) => ({
        id: row.id,
        goalType: row.goal_type,
        name: row.name,
        targetAmount: Number(row.target_amount),
        depositAmount: Number(row.deposit_amount),
        targetDate: row.target_date,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    );
  });

  app.post("/api/goals", auth, async (request, response) => {
    const input = parse(goalSchema, request.body);
    if (input.depositAmount > input.targetAmount) {
      throw new ApiError(400, "Deposit cannot exceed the goal amount.");
    }
    const result = await pool.query(
      `INSERT INTO goals
       (id, user_id, goal_type, name, target_amount, deposit_amount, target_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, goal_type, name, target_amount, deposit_amount,
                 target_date, created_at, updated_at`,
      [
        randomUUID(),
        request.auth.id,
        input.goalType,
        input.name,
        input.targetAmount,
        input.depositAmount,
        input.targetDate || null,
      ],
    );
    const row = result.rows[0];
    response.status(201).json({
      id: row.id,
      goalType: row.goal_type,
      name: row.name,
      targetAmount: Number(row.target_amount),
      depositAmount: Number(row.deposit_amount),
      targetDate: row.target_date,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  });

  app.get("/api/notification-preferences", auth, async (request, response) => {
    const result = await pool.query(
      `SELECT payment_reminders_enabled, goal_updates_enabled
       FROM notification_preferences WHERE user_id = $1`,
      [request.auth.id],
    );
    response.json({
      paymentRemindersEnabled:
        result.rows[0]?.payment_reminders_enabled ?? false,
      goalUpdatesEnabled: result.rows[0]?.goal_updates_enabled ?? false,
    });
  });

  app.patch("/api/notification-preferences", auth, async (request, response) => {
    const input = parse(preferenceSchema, request.body);
    const current = await pool.query(
      `SELECT payment_reminders_enabled, goal_updates_enabled
       FROM notification_preferences WHERE user_id = $1`,
      [request.auth.id],
    );
    const preferences = {
      paymentRemindersEnabled:
        input.paymentRemindersEnabled ??
        current.rows[0]?.payment_reminders_enabled ??
        false,
      goalUpdatesEnabled:
        input.goalUpdatesEnabled ??
        current.rows[0]?.goal_updates_enabled ??
        false,
    };
    await pool.query(
      `INSERT INTO notification_preferences
       (user_id, payment_reminders_enabled, goal_updates_enabled, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
       payment_reminders_enabled = EXCLUDED.payment_reminders_enabled,
       goal_updates_enabled = EXCLUDED.goal_updates_enabled,
       updated_at = NOW()`,
      [
        request.auth.id,
        preferences.paymentRemindersEnabled,
        preferences.goalUpdatesEnabled,
      ],
    );
    response.json(preferences);
  });

  app.get("/api/overview", auth, async (request, response) => {
    const [profileResult, debtResult, paymentResult, goalResult] =
      await Promise.all([
        pool.query(
          `SELECT gross_monthly_income, take_home_income, essential_expenses,
                  monthly_buffer
           FROM financial_profiles WHERE user_id = $1`,
          [request.auth.id],
        ),
        pool.query(
          `SELECT id, name, debt_type, balance, monthly_payment, annual_rate,
                  created_at, updated_at
           FROM debt_accounts WHERE user_id = $1 ORDER BY created_at`,
          [request.auth.id],
        ),
        pool.query(
          `SELECT payments.id, payments.debt_account_id,
                  debt_accounts.name AS debt_name, payments.amount,
                  payments.note, payments.paid_at, payments.created_at
           FROM payments
           LEFT JOIN debt_accounts ON debt_accounts.id = payments.debt_account_id
           WHERE payments.user_id = $1
           ORDER BY payments.paid_at DESC LIMIT 10`,
          [request.auth.id],
        ),
        pool.query(
          `SELECT id, goal_type, name, target_amount, deposit_amount, target_date
           FROM goals WHERE user_id = $1 ORDER BY created_at DESC`,
          [request.auth.id],
        ),
      ]);
    const profileRow = profileResult.rows[0] || {};
    const profile = {
      grossMonthlyIncome: Number(profileRow.gross_monthly_income || 0),
      takeHomeIncome: Number(profileRow.take_home_income || 0),
      essentialExpenses: Number(profileRow.essential_expenses || 0),
      monthlyBuffer: Number(profileRow.monthly_buffer || 0),
    };
    const debts = debtResult.rows.map(mapDebt);
    const totalDebt = debts.reduce((sum, debt) => sum + debt.balance, 0);
    const monthlyDebtPayment = debts.reduce(
      (sum, debt) => sum + debt.monthlyPayment,
      0,
    );
    const affordability = calculateAffordability({
      grossIncome: profile.grossMonthlyIncome,
      takeHomeIncome: profile.takeHomeIncome,
      monthlyDebtPayment,
      essentialExpenses: profile.essentialExpenses,
      monthlyBuffer: profile.monthlyBuffer,
      debtBalance: totalDebt,
      payoffPercent: 0,
      goalPrice: 0,
      depositPercent: 0,
      annualRatePercent: 0,
      termMonths: 0,
    });

    response.json({
      profile,
      debts,
      goals: goalResult.rows.map((row) => ({
        id: row.id,
        goalType: row.goal_type,
        name: row.name,
        targetAmount: Number(row.target_amount),
        depositAmount: Number(row.deposit_amount),
        targetDate: row.target_date,
      })),
      recentPayments: paymentResult.rows.map(mapPayment),
      overview: {
        totalDebt,
        monthlyDebtPayment,
        debtToIncomeRatio: affordability.debtToIncomeRatio,
        monthlyRoom:
          affordability.monthlyCapacityAfterPaydown,
      },
    });
  });

  app.post("/api/coach", auth, async (request, response) => {
    const { question } = parse(
      z.object({ question: z.string().trim().min(1).max(500) }),
      request.body,
    );
    const [profileResult, debtResult] = await Promise.all([
      pool.query(
        `SELECT gross_monthly_income, take_home_income, essential_expenses,
                monthly_buffer
         FROM financial_profiles WHERE user_id = $1`,
        [request.auth.id],
      ),
      pool.query(
        `SELECT COALESCE(SUM(balance), 0) AS total_debt,
                COALESCE(SUM(monthly_payment), 0) AS monthly_debt_payment
         FROM debt_accounts WHERE user_id = $1`,
        [request.auth.id],
      ),
    ]);
    const profileRow = profileResult.rows[0] || {};
    const profile = numericRecord({
      grossIncome: profileRow.gross_monthly_income || 0,
      takeHomeIncome: profileRow.take_home_income || 0,
      essentialExpenses: profileRow.essential_expenses || 0,
      monthlyBuffer: profileRow.monthly_buffer || 0,
      totalDebt: debtResult.rows[0].total_debt,
      monthlyDebtPayment: debtResult.rows[0].monthly_debt_payment,
    });
    const monthlyRoom = Math.max(
      0,
      profile.takeHomeIncome -
        profile.essentialExpenses -
        profile.monthlyBuffer -
        profile.monthlyDebtPayment,
    );
    const ratio =
      profile.grossIncome > 0
        ? (profile.monthlyDebtPayment / profile.grossIncome) * 100
        : null;
    const questionText = question.toLowerCase();
    const focus = questionText.includes("car")
      ? "For a car, compare the full ownership cost—including insurance, fuel, maintenance, and fees—not only the installment."
      : questionText.includes("home") ||
          questionText.includes("house") ||
          questionText.includes("mortgage")
        ? "For a home, account for rates, levies, insurance, utilities, transfer costs, and possible rate changes in addition to the bond payment."
        : "A useful next step is to compare any new payment with your monthly room while keeping your safety buffer intact.";
    response.json({
      answer: `Your current listed debt is ${profile.totalDebt.toFixed(2)} with monthly debt payments of ${profile.monthlyDebtPayment.toFixed(2)}. ${
        ratio === null
          ? "Add gross income to estimate your debt-to-income ratio."
          : `Your listed debt-to-income ratio is ${ratio.toFixed(1)}%.`
      } Your modeled monthly room after listed essentials and buffer is ${monthlyRoom.toFixed(2)}. ${focus}`,
      mode: "rules-based",
      disclaimer:
        "Illustrative information only. This is not financial advice, a lender assessment, or a credit decision.",
    });
  });

  app.post("/api/negotiation-draft", auth, (request, response) => {
    const input = parse(negotiationSchema, request.body);
    const requestText =
      input.proposalType === "restructure"
        ? "whether a revised repayment arrangement may be available for my account"
        : "whether a suitable debt-consolidation option may be available for my circumstances";
    response.json({
      draft: `Dear ${input.creditorName},\n\nI am contacting you to discuss my account. ${input.reason}\n\nI would like to ask ${requestText}. Based on my current budget, I would like to discuss a monthly payment of R${input.preferredMonthlyPayment.toFixed(2)}.\n\nPlease provide any proposed terms in writing, including fees, interest, the total amount repayable, the effect on the account and my credit record, and whether the arrangement changes the repayment term. I will review the details before deciding whether to proceed.\n\nKind regards,\n[Your name]`,
      disclaimer:
        "Draft for review only. It is not legal or financial advice and does not contact the creditor.",
    });
  });

  app.use((request, response) => {
    response.status(404).json({ error: "Route not found." });
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    if (error instanceof ApiError) {
      return response
        .status(error.status)
        .json({ error: error.message, ...(error.details ? { details: error.details } : {}) });
    }
    if (error?.type === "entity.parse.failed") {
      return response.status(400).json({ error: "Invalid JSON request body." });
    }
    if (error?.code === "23503") {
      return response.status(404).json({ error: "Requested record not found." });
    }
    if (error?.code === "23514" || error?.code === "22P02") {
      return response.status(400).json({ error: "Invalid request." });
    }
    process.stderr.write("An API request failed.\n");
    return response.status(500).json({ error: "Something went wrong." });
  });

  return app;
}
