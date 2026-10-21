import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { Prisma } from "../generated/prisma/client.ts";
import { z } from "zod";
import { calculateAffordability } from "../lib/affordability.js";
import {
  createIdempotently,
  requestFingerprint,
} from "./idempotency.js";
import {
  createSessionToken,
  dummyPasswordHash,
  hashPassword,
  hashSessionToken,
  readSessionToken,
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
if (
  process.env.NODE_ENV === "production" &&
  [...allowedOrigins].some((origin) => new URL(origin).protocol !== "https:")
) {
  throw new Error("All browser origins must use HTTPS in production.");
}

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const emailSchema = z.string().trim().email().max(254);
const passwordSchema = z.string().min(12).max(128);
const amountSchema = z.coerce
  .number()
  .finite()
  .min(0)
  .max(1_000_000_000)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6);
const positiveAmountSchema = amountSchema.min(0.01);
const uuidSchema = z.string().uuid();
const idempotencyKeySchema = z
  .string()
  .trim()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9._~-]+$/);

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
const withdrawConsentSchema = z.object({
  consentType: z.enum(["open_banking", "ai_processing", "marketing"]),
});

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

function idempotencyKey(request) {
  return parse(idempotencyKeySchema, request.get("idempotency-key"));
}

function decimal(value) {
  return new Prisma.Decimal(value.toFixed(2));
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

function mapProfile(profile) {
  if (!profile) return null;
  return {
    grossMonthlyIncome: Number(profile.grossMonthlyIncome),
    takeHomeIncome: Number(profile.takeHomeIncome),
    essentialExpenses: Number(profile.essentialExpenses),
    monthlyBuffer: Number(profile.monthlyBuffer),
    updatedAt: profile.updatedAt,
  };
}

function mapDebt(debt) {
  return {
    id: debt.id,
    name: debt.name,
    debtType: debt.debtType,
    balance: Number(debt.balance),
    monthlyPayment: Number(debt.monthlyPayment),
    annualRate: Number(debt.annualRate),
    createdAt: debt.createdAt,
    updatedAt: debt.updatedAt,
  };
}

function mapPayment(payment) {
  return {
    id: payment.id,
    debtAccountId: payment.debtAccountId,
    debtName: payment.debtAccount?.name || null,
    amount: Number(payment.amount),
    note: payment.note,
    paidAt: payment.paidAt,
    createdAt: payment.createdAt,
  };
}

function mapGoal(goal) {
  return {
    id: goal.id,
    goalType: goal.goalType,
    name: goal.name,
    targetAmount: Number(goal.targetAmount),
    depositAmount: Number(goal.depositAmount),
    targetDate: goal.targetDate,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  };
}

function requireAuth(prisma) {
  return async (request, response, next) => {
    try {
      const token = readSessionToken(request);
      if (!token || token.length > 128) {
        throw new ApiError(401, "Sign in to continue.");
      }
      const session = await prisma.session.findFirst({
        where: {
          tokenHash: hashSessionToken(token),
          expiresAt: { gt: new Date() },
        },
        select: { user: { select: { id: true, email: true } } },
      });
      if (!session) throw new ApiError(401, "Sign in to continue.");
      request.auth = { ...session.user, token };
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

function sendCreated(response, record, replayed, mapper) {
  response.status(replayed ? 200 : 201).json(mapper(record));
}

export function createApp({ prisma }) {
  const app = express();
  const auth = requireAuth(prisma);
  const authLimiter = createAuthLimiter();
  const apiLimiter = createApiLimiter();

  app.disable("x-powered-by");
  app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        callback(null, !origin || allowedOrigins.has(origin));
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Client-Platform",
        "Idempotency-Key",
      ],
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
      await prisma.$queryRaw`SELECT 1`;
      response.json({ status: "ok" });
    } catch (error) {
      next(error);
    }
  });

  app.post("/auth/register", authLimiter, async (request, response) => {
    const input = parse(registerSchema, request.body);
    const email = input.email.toLowerCase();
    const token = createSessionToken();
    const passwordHash = await hashPassword(input.password);
    const expiresAt = new Date(Date.now() + sessionLifetimeMs);

    try {
      const user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email,
            passwordHash,
            privacyConsentAt: new Date(),
            financialProfile: { create: {} },
            notificationPreferences: { create: {} },
            consentRecords: {
              create: {
                consentType: "privacy_notice",
                policyVersion: privacyPolicyVersion,
              },
            },
          },
          select: { id: true, email: true, createdAt: true },
        });
        await tx.session.create({
          data: {
            userId: created.id,
            tokenHash: hashSessionToken(token),
            expiresAt,
          },
        });
        return created;
      });
      setSessionCookie(response, token);
      response.status(201).json({
        user,
        ...(request.get("x-client-platform") === "android"
          ? { accessToken: token }
          : {}),
      });
    } catch (error) {
      if (error.code === "P2002") {
        throw new ApiError(409, "An account with that email already exists.");
      }
      throw error;
    }
  });

  app.post("/auth/login", authLimiter, async (request, response) => {
    const input = parse(loginSchema, request.body);
    const user = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });
    const passwordMatches = await verifyPassword(
      input.password,
      user?.passwordHash || (await dummyPasswordHash),
    );
    if (!user || !passwordMatches) {
      throw new ApiError(401, "Invalid email or password.");
    }

    const token = createSessionToken();
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + sessionLifetimeMs),
      },
    });
    setSessionCookie(response, token);
    response.json({
      user: { id: user.id, email: user.email, createdAt: user.createdAt },
      ...(request.get("x-client-platform") === "android"
        ? { accessToken: token }
        : {}),
    });
  });

  app.post("/auth/logout", async (request, response) => {
    const token = readSessionToken(request);
    if (token && token.length <= 128) {
      await prisma.session.deleteMany({
        where: { tokenHash: hashSessionToken(token) },
      });
    }
    response.clearCookie("debtaware_session", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    response.status(204).end();
  });

  app.get("/auth/me", auth, (request, response) => {
    response.json({
      user: { id: request.auth.id, email: request.auth.email },
    });
  });

  app.get("/api/account/export", auth, async (request, response) => {
    const [profile, debts, payments, goals, preferences, consents] =
      await Promise.all([
        prisma.financialProfile.findUnique({
          where: { userId: request.auth.id },
        }),
        prisma.debtAccount.findMany({
          where: { userId: request.auth.id },
          orderBy: { createdAt: "asc" },
        }),
        prisma.payment.findMany({
          where: { userId: request.auth.id },
          include: { debtAccount: { select: { name: true } } },
          orderBy: { paidAt: "asc" },
        }),
        prisma.goal.findMany({
          where: { userId: request.auth.id },
          orderBy: { createdAt: "asc" },
        }),
        prisma.notificationPreference.findUnique({
          where: { userId: request.auth.id },
        }),
        prisma.consentRecord.findMany({
          where: { userId: request.auth.id },
          orderBy: { grantedAt: "asc" },
        }),
      ]);
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="debtaware-account-export.json"',
    );
    response.json({
      exportedAt: new Date().toISOString(),
      account: { id: request.auth.id, email: request.auth.email },
      financialProfile: mapProfile(profile),
      debtAccounts: debts.map(mapDebt),
      payments: payments.map(mapPayment),
      goals: goals.map(mapGoal),
      notificationPreferences: preferences,
      consentRecords: consents,
    });
  });

  app.delete("/api/account", auth, async (request, response) => {
    const input = parse(
      z.object({ email: emailSchema, password: passwordSchema }),
      request.body,
    );
    if (input.email.toLowerCase() !== request.auth.email) {
      throw new ApiError(403, "Email confirmation did not match.");
    }
    const user = await prisma.user.findUnique({
      where: { id: request.auth.id },
      select: { passwordHash: true },
    });
    if (
      !user ||
      !(await verifyPassword(input.password, user.passwordHash))
    ) {
      throw new ApiError(403, "Password confirmation failed.");
    }
    await prisma.user.delete({ where: { id: request.auth.id } });
    response.clearCookie("debtaware_session", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    response.status(204).end();
  });

  app.get("/api/consents", auth, async (request, response) => {
    const records = await prisma.consentRecord.findMany({
      where: { userId: request.auth.id },
      orderBy: { grantedAt: "asc" },
    });
    response.json(records);
  });

  app.post("/api/consents/withdraw", auth, async (request, response) => {
    const input = parse(withdrawConsentSchema, request.body);
    await prisma.consentRecord.updateMany({
      where: {
        userId: request.auth.id,
        consentType: input.consentType,
        withdrawnAt: null,
      },
      data: { withdrawnAt: new Date() },
    });
    response.status(204).end();
  });

  app.get("/api/profile", auth, async (request, response) => {
    const profile = await prisma.financialProfile.findUnique({
      where: { userId: request.auth.id },
    });
    response.json(mapProfile(profile));
  });

  app.get("/api/integrations", auth, (request, response) => {
    response.json(getIntegrationStatus());
  });

  app.patch("/api/profile", auth, async (request, response) => {
    const input = parse(profileSchema, request.body);
    const profile = await prisma.financialProfile.update({
      where: { userId: request.auth.id },
      data: Object.fromEntries(
        Object.entries(input).map(([key, value]) => [key, decimal(value)]),
      ),
    });
    response.json(mapProfile(profile));
  });

  app.get("/api/debts", auth, async (request, response) => {
    const debts = await prisma.debtAccount.findMany({
      where: { userId: request.auth.id },
      orderBy: { createdAt: "asc" },
    });
    response.json(debts.map(mapDebt));
  });

  app.post("/api/debts", auth, async (request, response) => {
    const input = parse(debtSchema, request.body);
    const key = idempotencyKey(request);
    const fingerprint = requestFingerprint(input);
    const where = {
      userId_idempotencyKey: {
        userId: request.auth.id,
        idempotencyKey: key,
      },
    };
    const result = await createIdempotently({
      findExisting: () => prisma.debtAccount.findUnique({ where }),
      create: () =>
        prisma.debtAccount.create({
          data: {
            userId: request.auth.id,
            name: input.name,
            debtType: input.debtType,
            balance: decimal(input.balance),
            monthlyPayment: decimal(input.monthlyPayment),
            annualRate: decimal(input.annualRate),
            idempotencyKey: key,
            requestHash: fingerprint,
          },
        }),
      fingerprint,
    });
    sendCreated(response, result.record, result.replayed, mapDebt);
  });

  app.get("/api/payments", auth, async (request, response) => {
    const payments = await prisma.payment.findMany({
      where: { userId: request.auth.id },
      include: { debtAccount: { select: { name: true } } },
      orderBy: { paidAt: "desc" },
      take: 100,
    });
    response.json(payments.map(mapPayment));
  });

  app.post("/api/payments", auth, async (request, response) => {
    const input = parse(paymentSchema, request.body);
    const key = idempotencyKey(request);
    const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
    const fingerprint = requestFingerprint({
      ...input,
      paidAt: input.paidAt ? paidAt.toISOString() : null,
    });
    const where = {
      userId_idempotencyKey: {
        userId: request.auth.id,
        idempotencyKey: key,
      },
    };
    const result = await createIdempotently({
      findExisting: () =>
        prisma.payment.findUnique({
          where,
          include: { debtAccount: { select: { name: true } } },
        }),
      create: () =>
        prisma.$transaction(async (tx) => {
          if (input.debtAccountId) {
            const debts = await tx.$queryRaw`
              SELECT "balance" FROM "debt_accounts"
              WHERE "id" = ${input.debtAccountId}::uuid
                AND "user_id" = ${request.auth.id}::uuid
              FOR UPDATE
            `;
            if (!debts.length) {
              throw new ApiError(404, "Debt account not found.");
            }
            const nextBalance = Math.max(
              0,
              Number(debts[0].balance) - input.amount,
            );
            await tx.debtAccount.update({
              where: { id: input.debtAccountId },
              data: { balance: decimal(nextBalance) },
            });
          }
          return tx.payment.create({
            data: {
              userId: request.auth.id,
              debtAccountId: input.debtAccountId || null,
              amount: decimal(input.amount),
              note: input.note,
              paidAt,
              idempotencyKey: key,
              requestHash: fingerprint,
            },
            include: { debtAccount: { select: { name: true } } },
          });
        }),
      fingerprint,
    });
    sendCreated(response, result.record, result.replayed, mapPayment);
  });

  app.get("/api/goals", auth, async (request, response) => {
    const goals = await prisma.goal.findMany({
      where: { userId: request.auth.id },
      orderBy: { createdAt: "desc" },
    });
    response.json(goals.map(mapGoal));
  });

  app.post("/api/goals", auth, async (request, response) => {
    const input = parse(goalSchema, request.body);
    if (input.depositAmount > input.targetAmount) {
      throw new ApiError(400, "Deposit cannot exceed the goal amount.");
    }
    const key = idempotencyKey(request);
    const fingerprint = requestFingerprint(input);
    const where = {
      userId_idempotencyKey: {
        userId: request.auth.id,
        idempotencyKey: key,
      },
    };
    const result = await createIdempotently({
      findExisting: () => prisma.goal.findUnique({ where }),
      create: () =>
        prisma.goal.create({
          data: {
            userId: request.auth.id,
            goalType: input.goalType,
            name: input.name,
            targetAmount: decimal(input.targetAmount),
            depositAmount: decimal(input.depositAmount),
            targetDate: input.targetDate
              ? new Date(`${input.targetDate}T00:00:00.000Z`)
              : null,
            idempotencyKey: key,
            requestHash: fingerprint,
          },
        }),
      fingerprint,
    });
    sendCreated(response, result.record, result.replayed, mapGoal);
  });

  app.get("/api/notification-preferences", auth, async (request, response) => {
    const preferences = await prisma.notificationPreference.findUnique({
      where: { userId: request.auth.id },
    });
    response.json({
      paymentRemindersEnabled:
        preferences?.paymentRemindersEnabled ?? false,
      goalUpdatesEnabled: preferences?.goalUpdatesEnabled ?? false,
    });
  });

  app.patch("/api/notification-preferences", auth, async (request, response) => {
    const input = parse(preferenceSchema, request.body);
    const current = await prisma.notificationPreference.findUnique({
      where: { userId: request.auth.id },
    });
    const preferences = {
      paymentRemindersEnabled:
        input.paymentRemindersEnabled ??
        current?.paymentRemindersEnabled ??
        false,
      goalUpdatesEnabled:
        input.goalUpdatesEnabled ?? current?.goalUpdatesEnabled ?? false,
    };
    const updated = await prisma.notificationPreference.upsert({
      where: { userId: request.auth.id },
      create: { userId: request.auth.id, ...preferences },
      update: preferences,
    });
    response.json({
      paymentRemindersEnabled: updated.paymentRemindersEnabled,
      goalUpdatesEnabled: updated.goalUpdatesEnabled,
    });
  });

  app.get("/api/overview", auth, async (request, response) => {
    const [profileResult, debtRows, paymentRows, goalRows] = await Promise.all([
      prisma.financialProfile.findUnique({
        where: { userId: request.auth.id },
      }),
      prisma.debtAccount.findMany({ where: { userId: request.auth.id } }),
      prisma.payment.findMany({
        where: { userId: request.auth.id },
        include: { debtAccount: { select: { name: true } } },
        orderBy: { paidAt: "desc" },
        take: 10,
      }),
      prisma.goal.findMany({
        where: { userId: request.auth.id },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const profile = mapProfile(profileResult) || {
      grossMonthlyIncome: 0,
      takeHomeIncome: 0,
      essentialExpenses: 0,
      monthlyBuffer: 0,
    };
    const debts = debtRows.map(mapDebt);
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
      goals: goalRows.map(mapGoal),
      recentPayments: paymentRows.map(mapPayment),
      overview: {
        totalDebt,
        monthlyDebtPayment,
        debtToIncomeRatio: affordability.debtToIncomeRatio,
        monthlyRoom: affordability.monthlyCapacityAfterPaydown,
      },
    });
  });

  app.post("/api/coach", auth, async (request, response) => {
    const { question } = parse(
      z.object({ question: z.string().trim().min(1).max(500) }),
      request.body,
    );
    const [profileResult, debtSummary] = await Promise.all([
      prisma.financialProfile.findUnique({
        where: { userId: request.auth.id },
      }),
      prisma.debtAccount.aggregate({
        where: { userId: request.auth.id },
        _sum: { balance: true, monthlyPayment: true },
      }),
    ]);
    const profile = mapProfile(profileResult) || {
      grossMonthlyIncome: 0,
      takeHomeIncome: 0,
      essentialExpenses: 0,
      monthlyBuffer: 0,
    };
    const totalDebt = Number(debtSummary._sum.balance || 0);
    const monthlyDebtPayment = Number(debtSummary._sum.monthlyPayment || 0);
    const monthlyRoom = Math.max(
      0,
      profile.takeHomeIncome -
        profile.essentialExpenses -
        profile.monthlyBuffer -
        monthlyDebtPayment,
    );
    const ratio =
      profile.grossMonthlyIncome > 0
        ? (monthlyDebtPayment / profile.grossMonthlyIncome) * 100
        : null;
    const questionText = question.toLowerCase();
    const focus = questionText.includes("car")
      ? "For a car, compare the full ownership cost—including insurance, fuel, maintenance, and fees—not only the instalment."
      : questionText.includes("home") ||
          questionText.includes("house") ||
          questionText.includes("mortgage")
        ? "For a home, account for rates, levies, insurance, utilities, transfer costs, and possible rate changes in addition to the bond payment."
        : "A useful next step is to compare any new payment with your monthly room while keeping your safety buffer intact.";
    response.json({
      answer: `Your current listed debt is ${totalDebt.toFixed(2)} with monthly debt payments of ${monthlyDebtPayment.toFixed(2)}. ${
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
    if (error instanceof ApiError || error?.status === 409) {
      return response
        .status(error.status)
        .json({
          error: error.message,
          ...(error.details ? { details: error.details } : {}),
        });
    }
    if (error?.code === "P2002") {
      return response.status(409).json({ error: "A conflicting record already exists." });
    }
    if (error?.code === "P2003" || error?.code === "P2025") {
      return response.status(404).json({ error: "Requested record not found." });
    }
    if (error?.code === "P2004") {
      return response.status(400).json({ error: "Invalid request." });
    }
    if (error?.type === "entity.parse.failed") {
      return response.status(400).json({ error: "Invalid JSON request body." });
    }
    process.stderr.write("An API request failed.\n");
    return response.status(500).json({ error: "Something went wrong." });
  });

  return app;
}
