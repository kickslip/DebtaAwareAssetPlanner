"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  CircleHelp,
  CreditCard,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const emptyProfile = {
  grossMonthlyIncome: 0,
  takeHomeIncome: 0,
  essentialExpenses: 0,
  monthlyBuffer: 0,
};

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

function MoneyInput({ label, value, onChange }) {
  return (
    <label className="account-field">
      <span>{label}</span>
      <span className="account-money-input">
        <span>R</span>
        <input
          type="number"
          min="0"
          step="100"
          value={value}
          onChange={(event) => onChange(Number(event.target.value) || 0)}
        />
      </span>
    </label>
  );
}

function FormMessage({ message, kind = "error" }) {
  if (!message) return null;
  return <p className={`form-message ${kind}`}>{message}</p>;
}

export default function AccountPage() {
  const [user, setUser] = useState(null);
  const [overview, setOverview] = useState(null);
  const [profile, setProfile] = useState(emptyProfile);
  const [preferences, setPreferences] = useState({
    paymentRemindersEnabled: false,
    goalUpdatesEnabled: false,
  });
  const [integrations, setIntegrations] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState("login");
  const [authForm, setAuthForm] = useState({
    email: "",
    password: "",
    privacyConsent: false,
  });
  const [debtForm, setDebtForm] = useState({
    name: "",
    debtType: "credit_card",
    balance: "",
    monthlyPayment: "",
    annualRate: "",
  });
  const [paymentForm, setPaymentForm] = useState({
    debtAccountId: "",
    amount: "",
    note: "",
  });
  const [goalForm, setGoalForm] = useState({
    goalType: "home",
    name: "",
    targetAmount: "",
    depositAmount: "",
    targetDate: "",
  });
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [negotiationForm, setNegotiationForm] = useState({
    creditorName: "",
    proposalType: "restructure",
    preferredMonthlyPayment: "",
    reason: "",
  });
  const [negotiationDraft, setNegotiationDraft] = useState("");

  const refresh = useCallback(async () => {
    const [data, currentPreferences, providerStatus] = await Promise.all([
      api("/api/overview"),
      api("/api/notification-preferences"),
      api("/api/integrations"),
    ]);
    setOverview(data);
    setProfile(data.profile);
    setPreferences(currentPreferences);
    setIntegrations(providerStatus);
    setPaymentForm((current) => ({
      ...current,
      debtAccountId: current.debtAccountId || data.debts[0]?.id || "",
    }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api("/auth/me")
      .then(async (result) => {
        if (cancelled) return;
        setUser(result.user);
        await refresh();
      })
      .catch((requestError) => {
        if (requestError.message !== "Sign in to continue.") {
          setError(
            "The account API is unavailable. Start PostgreSQL and the API, then try again.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const perform = async (action, successMessage) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (successMessage) setNotice(successMessage);
    } catch (requestError) {
      setError(requestError.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const submitAuth = (event) => {
    event.preventDefault();
    perform(
      async () => {
        const path = mode === "register" ? "/auth/register" : "/auth/login";
        const result = await api(path, {
          method: "POST",
          body: JSON.stringify(authForm),
        });
        setUser(result.user);
        await refresh();
      },
      mode === "register" ? "Your account is ready." : "Signed in successfully.",
    );
  };

  const saveProfile = (event) => {
    event.preventDefault();
    perform(
      async () => {
        await api("/api/profile", {
          method: "PATCH",
          body: JSON.stringify(profile),
        });
        await refresh();
      },
      "Financial snapshot saved.",
    );
  };

  const addDebt = (event) => {
    event.preventDefault();
    perform(
      async () => {
        await api("/api/debts", {
          method: "POST",
          body: JSON.stringify({
            ...debtForm,
            balance: Number(debtForm.balance),
            monthlyPayment: Number(debtForm.monthlyPayment),
            annualRate: Number(debtForm.annualRate) || 0,
          }),
        });
        setDebtForm({
          name: "",
          debtType: "credit_card",
          balance: "",
          monthlyPayment: "",
          annualRate: "",
        });
        await refresh();
      },
      "Debt account added.",
    );
  };

  const addPayment = (event) => {
    event.preventDefault();
    perform(
      async () => {
        await api("/api/payments", {
          method: "POST",
          body: JSON.stringify({
            debtAccountId: paymentForm.debtAccountId || null,
            amount: Number(paymentForm.amount),
            note: paymentForm.note,
          }),
        });
        setPaymentForm((current) => ({ ...current, amount: "", note: "" }));
        await refresh();
      },
      "Payment recorded and debt overview updated.",
    );
  };

  const addGoal = (event) => {
    event.preventDefault();
    perform(
      async () => {
        await api("/api/goals", {
          method: "POST",
          body: JSON.stringify({
            ...goalForm,
            targetAmount: Number(goalForm.targetAmount),
            depositAmount: Number(goalForm.depositAmount) || 0,
            targetDate: goalForm.targetDate || null,
          }),
        });
        setGoalForm({
          goalType: "home",
          name: "",
          targetAmount: "",
          depositAmount: "",
          targetDate: "",
        });
        await refresh();
      },
      "Goal saved.",
    );
  };

  const updatePreference = (key, value) =>
    perform(async () => {
      const updated = await api("/api/notification-preferences", {
        method: "PATCH",
        body: JSON.stringify({ [key]: value }),
      });
      setPreferences(updated);
    }, "Notification preferences updated.");

  const askCoach = (event) => {
    event.preventDefault();
    perform(async () => {
      const result = await api("/api/coach", {
        method: "POST",
        body: JSON.stringify({ question }),
      });
      setAnswer(result.answer);
    });
  };

  const createNegotiationDraft = (event) => {
    event.preventDefault();
    perform(async () => {
      const result = await api("/api/negotiation-draft", {
        method: "POST",
        body: JSON.stringify({
          ...negotiationForm,
          preferredMonthlyPayment: Number(
            negotiationForm.preferredMonthlyPayment,
          ),
        }),
      });
      setNegotiationDraft(result.draft);
    });
  };

  const signOut = () =>
    perform(async () => {
      await api("/auth/logout", { method: "POST" });
      setUser(null);
      setOverview(null);
      setAnswer("");
    }, "You have signed out.");

  const downloadExport = () =>
    perform(async () => {
      const response = await fetch(`${API_URL}/api/account/export`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Could not export account data.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "debtaware-account-export.json";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "Your account export was downloaded.");

  const deleteAccount = () => {
    if (
      !window.confirm(
        "Permanently delete your account and all saved financial data?",
      )
    ) {
      return;
    }
    const password = window.prompt("Enter your password to confirm deletion.");
    if (!password) return;
    perform(async () => {
      await api("/api/account", {
        method: "DELETE",
        body: JSON.stringify({ email: user.email, password }),
      });
      setUser(null);
      setOverview(null);
    });
  };

  if (loading) {
    return (
      <main className="account-page">
        <div className="account-loading">Loading your secure workspace…</div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="account-page">
        <div className="account-topline">
          <Link className="back-link" href="/">
            <ArrowLeft size={15} /> Back to planner
          </Link>
          <span className="secure-label">
            <ShieldCheck size={15} /> Private account workspace
          </span>
        </div>
        <section className="auth-card">
          <span className="account-eyebrow">DEBTAWARE ACCOUNT</span>
          <h1>{mode === "register" ? "Create your account" : "Welcome back"}</h1>
          <p className="account-intro">
            Save your financial snapshot, payment history, and goals securely.
            Your information is only used to provide your planning workspace.
          </p>
          <FormMessage message={error} />
          <FormMessage message={notice} kind="success" />
          <form className="account-form" onSubmit={submitAuth}>
            <label className="account-field">
              <span>Email address</span>
              <input
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={authForm.email}
                onChange={(event) =>
                  setAuthForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
              />
            </label>
            <label className="account-field">
              <span>Password</span>
              <input
                type="password"
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                required
                minLength={mode === "register" ? 12 : 1}
                maxLength={128}
                value={authForm.password}
                onChange={(event) =>
                  setAuthForm((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
              />
              {mode === "register" && (
                <small>Use at least 12 characters.</small>
              )}
            </label>
            {mode === "register" && (
              <label className="consent-check">
                <input
                  type="checkbox"
                  required
                  checked={authForm.privacyConsent}
                  onChange={(event) =>
                    setAuthForm((current) => ({
                      ...current,
                      privacyConsent: event.target.checked,
                    }))
                  }
                />
                <span>
                  I acknowledge the{" "}
                  <Link href="/privacy" target="_blank">
                    prototype privacy notice
                  </Link>{" "}
                  and consent to storing my account and financial entries.
                </span>
              </label>
            )}
            <button className="account-primary" disabled={busy}>
              {busy
                ? "Please wait…"
                : mode === "register"
                  ? "Create account"
                  : "Sign in"}
            </button>
          </form>
          <p className="auth-switch">
            {mode === "register"
              ? "Already have an account?"
              : "New to DebtAware?"}{" "}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "register" ? "login" : "register");
                setError("");
                setNotice("");
              }}
            >
              {mode === "register" ? "Sign in" : "Create an account"}
            </button>
          </p>
          <p className="prototype-warning">
            Account recovery and email verification are not configured yet.
            Don&apos;t reuse a password from another service.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="account-page">
      <header className="account-topline">
        <Link className="back-link" href="/">
          <ArrowLeft size={15} /> Back to planner
        </Link>
      <div className="account-user">
        <span>{user.email}</span>
        <button className="signout-button" onClick={downloadExport} disabled={busy}>
          Export data
        </button>
        <button className="signout-button" onClick={signOut} disabled={busy}>
          <LogOut size={14} /> Sign out
        </button>
        </div>
      </header>
      <div className="account-content">
        <div className="account-heading">
          <div>
            <span className="account-eyebrow">YOUR PRIVATE WORKSPACE</span>
            <h1>Your plan, in one place.</h1>
            <p>
              Add payments, keep your debt picture current, and revisit your
              goals.
            </p>
          </div>
          <button
            className="refresh-button"
            onClick={() => perform(refresh, "Overview refreshed.")}
            disabled={busy}
          >
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
        <FormMessage message={error} />
        <FormMessage message={notice} kind="success" />
        <section className="account-metrics">
          <article>
            <span>Total debt balance</span>
            <strong>
              {formatCurrency(overview?.overview.totalDebt || 0)}
            </strong>
          </article>
          <article>
            <span>Monthly debt payments</span>
            <strong>
              {formatCurrency(overview?.overview.monthlyDebtPayment || 0)}
            </strong>
          </article>
          <article>
            <span>Debt-to-income ratio</span>
            <strong>
              {(overview?.overview.debtToIncomeRatio || 0).toFixed(1)}%
            </strong>
          </article>
          <article>
            <span>Modeled monthly room</span>
            <strong>{formatCurrency(overview?.overview.monthlyRoom || 0)}</strong>
          </article>
        </section>

        <div className="account-grid">
          <section className="account-card">
            <div className="account-card-title">
              <span className="account-card-icon"><Wallet size={17} /></span>
              <div><h2>Financial snapshot</h2><p>Only used for your planning estimates.</p></div>
            </div>
            <form className="account-form two-column-form" onSubmit={saveProfile}>
              <MoneyInput
                label="Gross monthly income"
                value={profile.grossMonthlyIncome}
                onChange={(value) => setProfile({ ...profile, grossMonthlyIncome: value })}
              />
              <MoneyInput
                label="Take-home income"
                value={profile.takeHomeIncome}
                onChange={(value) => setProfile({ ...profile, takeHomeIncome: value })}
              />
              <MoneyInput
                label="Essential expenses"
                value={profile.essentialExpenses}
                onChange={(value) => setProfile({ ...profile, essentialExpenses: value })}
              />
              <MoneyInput
                label="Monthly safety buffer"
                value={profile.monthlyBuffer}
                onChange={(value) => setProfile({ ...profile, monthlyBuffer: value })}
              />
              <button className="account-primary" disabled={busy}>Save snapshot</button>
            </form>
          </section>

          <section className="account-card">
            <div className="account-card-title">
              <span className="account-card-icon peach-icon"><CreditCard size={17} /></span>
              <div><h2>Debt accounts</h2><p>Balances are updated when you record a payment.</p></div>
            </div>
            <div className="debt-account-list">
              {overview?.debts.length ? overview.debts.map((debt) => (
                <div className="debt-account-row" key={debt.id}>
                  <span><strong>{debt.name}</strong><small>{debt.debtType.replaceAll("_", " ")}</small></span>
                  <span><strong>{formatCurrency(debt.balance)}</strong><small>{formatCurrency(debt.monthlyPayment)} / month</small></span>
                </div>
              )) : <p className="empty-state">Add a debt account to start tracking payments.</p>}
            </div>
            <form className="account-form debt-form" onSubmit={addDebt}>
              <label className="account-field">
                <span>Account name</span>
                <input required maxLength={80} value={debtForm.name} onChange={(event) => setDebtForm({ ...debtForm, name: event.target.value })} />
              </label>
              <label className="account-field">
                <span>Type</span>
                <select value={debtForm.debtType} onChange={(event) => setDebtForm({ ...debtForm, debtType: event.target.value })}>
                  <option value="credit_card">Credit card</option>
                  <option value="personal_loan">Personal loan</option>
                  <option value="vehicle">Vehicle finance</option>
                  <option value="home">Home loan</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <MoneyInput label="Current balance" value={debtForm.balance} onChange={(value) => setDebtForm({ ...debtForm, balance: value })} />
              <MoneyInput label="Monthly payment" value={debtForm.monthlyPayment} onChange={(value) => setDebtForm({ ...debtForm, monthlyPayment: value })} />
              <label className="account-field">
                <span>Annual interest rate (%)</span>
                <input type="number" min="0" max="100" step="0.1" value={debtForm.annualRate} onChange={(event) => setDebtForm({ ...debtForm, annualRate: event.target.value })} />
              </label>
              <button className="account-secondary" disabled={busy}><Plus size={14} /> Add debt</button>
            </form>
          </section>

          <section className="account-card">
            <div className="account-card-title">
              <span className="account-card-icon"><Plus size={17} /></span>
              <div><h2>Record a payment</h2><p>Manual entry only; no bank transfers are made.</p></div>
            </div>
            <form className="account-form" onSubmit={addPayment}>
              <label className="account-field">
                <span>Apply to debt account</span>
                <select value={paymentForm.debtAccountId} onChange={(event) => setPaymentForm({ ...paymentForm, debtAccountId: event.target.value })}>
                  <option value="">General payment (not linked to a debt)</option>
                  {overview?.debts.map((debt) => <option key={debt.id} value={debt.id}>{debt.name}</option>)}
                </select>
              </label>
              <MoneyInput label="Amount paid" value={paymentForm.amount} onChange={(value) => setPaymentForm({ ...paymentForm, amount: value })} />
              <label className="account-field">
                <span>Note (optional)</span>
                <input maxLength={250} value={paymentForm.note} onChange={(event) => setPaymentForm({ ...paymentForm, note: event.target.value })} placeholder="e.g. Extra payment" />
              </label>
              <button className="account-primary" disabled={busy || Number(paymentForm.amount) <= 0}>Save payment</button>
            </form>
            <div className="payment-history">
              <h3>Recent payments</h3>
              {overview?.recentPayments.length ? overview.recentPayments.map((payment) => (
                <div className="payment-row" key={payment.id}>
                  <span><strong>{payment.debtName || payment.note || "Payment"}</strong><small>{new Date(payment.paidAt).toLocaleDateString("en-ZA")}</small></span>
                  <strong>{formatCurrency(payment.amount)}</strong>
                </div>
              )) : <p className="empty-state">Your recorded payments will appear here.</p>}
            </div>
          </section>

          <section className="account-card">
            <div className="account-card-title">
              <span className="account-card-icon"><CircleHelp size={17} /></span>
              <div><h2>Goals and coaching</h2><p>Planning prompts use only your saved profile and debt totals.</p></div>
            </div>
            <form className="account-form" onSubmit={addGoal}>
              <label className="account-field">
                <span>Goal type</span>
                <select value={goalForm.goalType} onChange={(event) => setGoalForm({ ...goalForm, goalType: event.target.value })}>
                  <option value="home">Home</option><option value="car">Car</option><option value="other">Other</option>
                </select>
              </label>
              <label className="account-field">
                <span>Goal name</span>
                <input required maxLength={100} value={goalForm.name} onChange={(event) => setGoalForm({ ...goalForm, name: event.target.value })} placeholder="e.g. First home" />
              </label>
              <MoneyInput label="Target price" value={goalForm.targetAmount} onChange={(value) => setGoalForm({ ...goalForm, targetAmount: value })} />
              <MoneyInput label="Deposit saved" value={goalForm.depositAmount} onChange={(value) => setGoalForm({ ...goalForm, depositAmount: value })} />
              <label className="account-field">
                <span>Target date (optional)</span>
                <input type="date" value={goalForm.targetDate} onChange={(event) => setGoalForm({ ...goalForm, targetDate: event.target.value })} />
              </label>
              <button className="account-secondary" disabled={busy}><Plus size={14} /> Save goal</button>
            </form>
            <div className="saved-goals">
              {overview?.goals.map((goal) => (
                <div className="payment-row" key={goal.id}>
                  <span><strong>{goal.name}</strong><small>{goal.goalType} · target {goal.targetDate || "not set"}</small></span>
                  <strong>{formatCurrency(goal.targetAmount)}</strong>
                </div>
              ))}
            </div>
            <form className="coach-form" onSubmit={askCoach}>
              <label className="account-field">
                <span>Ask a planning question</span>
                <input maxLength={500} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What should I consider before a car loan?" />
              </label>
              <button className="account-primary" disabled={busy || !question.trim()}>Get a planning note</button>
            </form>
            {answer && <p className="coach-answer">{answer}<small>Rules-based estimate; not financial advice or a lender decision.</small></p>}
            <form className="coach-form" onSubmit={createNegotiationDraft}>
              <label className="account-field">
                <span>Creditor name</span>
                <input required maxLength={80} value={negotiationForm.creditorName} onChange={(event) => setNegotiationForm({ ...negotiationForm, creditorName: event.target.value })} />
              </label>
              <label className="account-field">
                <span>Request type</span>
                <select value={negotiationForm.proposalType} onChange={(event) => setNegotiationForm({ ...negotiationForm, proposalType: event.target.value })}>
                  <option value="restructure">Restructure payments</option>
                  <option value="consolidate">Ask about consolidation</option>
                </select>
              </label>
              <MoneyInput label="Preferred monthly payment" value={negotiationForm.preferredMonthlyPayment} onChange={(value) => setNegotiationForm({ ...negotiationForm, preferredMonthlyPayment: value })} />
              <label className="account-field">
                <span>Reason to share</span>
                <textarea required maxLength={500} rows={3} value={negotiationForm.reason} onChange={(event) => setNegotiationForm({ ...negotiationForm, reason: event.target.value })} />
              </label>
              <button className="account-secondary" disabled={busy}><Plus size={14} /> Draft a request</button>
            </form>
            {negotiationDraft && <pre className="negotiation-draft">{negotiationDraft}<small>Review and edit before sending. DebtAware does not contact creditors.</small></pre>}
          </section>

          <section className="account-card">
            <div className="account-card-title">
              <span className="account-card-icon"><Bell size={17} /></span>
              <div><h2>Notifications</h2><p>Choose which planning reminders the app may send.</p></div>
            </div>
            <label className="preference-row">
              <span><strong>Payment reminders</strong><small>Reminder prompts for payments you track.</small></span>
              <input type="checkbox" checked={preferences.paymentRemindersEnabled} disabled={busy} onChange={(event) => updatePreference("paymentRemindersEnabled", event.target.checked)} />
            </label>
            <label className="preference-row">
              <span><strong>Goal updates</strong><small>Progress prompts for saved goals.</small></span>
              <input type="checkbox" checked={preferences.goalUpdatesEnabled} disabled={busy} onChange={(event) => updatePreference("goalUpdatesEnabled", event.target.checked)} />
            </label>
          </section>
          <section className="account-card privacy-controls">
            <div className="account-card-title">
              <span className="account-card-icon"><ShieldCheck size={17} /></span>
              <div><h2>Your data</h2><p>Review the <Link href="/privacy">prototype privacy notice</Link>.</p></div>
            </div>
            <p className="privacy-controls-copy">You can download a JSON copy of your saved entries or permanently delete your account and its associated profile, debt accounts, payments, goals, preferences, and sessions.</p>
            <button className="delete-account-button" onClick={deleteAccount} disabled={busy}>Delete account and saved data</button>
          </section>
          <section className="account-card integration-status-card">
            <div className="account-card-title">
              <span className="account-card-icon"><ShieldCheck size={17} /></span>
              <div><h2>Connected services</h2><p>Live providers are not configured in this environment.</p></div>
            </div>
            <div className="integration-status-row">
              <span><strong>Bank data</strong><small>No open-banking provider connected</small></span>
              <span className="integration-pill">Manual entry</span>
            </div>
            <div className="integration-status-row">
              <span><strong>Lender options</strong><small>No verified lender catalogue available</small></span>
              <span className="integration-pill">Unavailable</span>
            </div>
            <div className="integration-status-row">
              <span><strong>Planning coach</strong><small>Account figures stay in the first-party API</small></span>
              <span className="integration-pill">{integrations?.coaching.status || "Rules-based"}</span>
            </div>
          </section>
        </div>
        <p className="account-disclaimer">
          <ShieldCheck size={14} /> Estimates are educational only and are not
          credit decisions, financial advice, or a promise of approval. The API
          and account flows are an early product foundation, not a POPIA
          compliance certification.
        </p>
      </div>
    </main>
  );
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}
