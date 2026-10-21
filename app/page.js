"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CarFront,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  CreditCard,
  House,
  Leaf,
  Lightbulb,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Wallet,
} from "lucide-react";
import { calculateAffordability } from "../lib/affordability.js";

const initialFinance = {
  grossIncome: 68500,
  takeHomeIncome: 52700,
  debtBalance: 182000,
  monthlyDebtPayment: 12100,
  essentialExpenses: 21000,
  monthlyBuffer: 2500,
  payoffPercent: 30,
  goalPrice: 2100000,
  depositPercent: 10,
};

const money = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 0,
});

function formatMoney(value) {
  return money.format(Math.round(Number.isFinite(value) ? value : 0));
}

function formatPercent(value) {
  return `${(Number.isFinite(value) ? value : 0).toFixed(1)}%`;
}

function NumberField({ label, value, onChange, prefix = "R", hint }) {
  return (
    <label className="number-field">
      <span className="field-label">{label}</span>
      <span className="input-wrap">
        {prefix && <span className="input-prefix">{prefix}</span>}
        <input
          type="number"
          min="0"
          step={prefix === "%" ? "1" : "100"}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function Sidebar() {
  return (
    <aside className="sidebar">
      <a className="brand" href="#overview" aria-label="DebtAware home">
        <span className="brand-mark">
          <Leaf size={19} strokeWidth={2.5} />
        </span>
        <span>
          debt<span className="brand-light">aware</span>
        </span>
      </a>
      <div className="workspace-switcher">
        <span className="workspace-avatar">S</span>
        <span className="workspace-copy">
          <strong>Personal plan</strong>
          <small>Demo workspace</small>
        </span>
        <ChevronDown size={15} />
      </div>
      <span className="side-label">WORKSPACE</span>
      <nav className="side-nav" aria-label="Main navigation">
        <a className="nav-item active" href="#overview">
          <SlidersHorizontal size={17} />
          <span>Overview</span>
        </a>
        <a className="nav-item" href="#goal">
          <House size={17} />
          <span>My goals</span>
          <span className="nav-count">1</span>
        </a>
        <a className="nav-item" href="#scenario">
          <Sparkles size={17} />
          <span>Scenarios</span>
        </a>
      </nav>
      <span className="side-label tools-label">TOOLS</span>
      <nav className="side-nav">
        <a className="nav-item" href="#snapshot">
          <Wallet size={17} />
          <span>Money snapshot</span>
        </a>
        <a className="nav-item" href="#guidance">
          <Lightbulb size={17} />
          <span>Plan notes</span>
        </a>
      </nav>
      <div className="sidebar-bottom">
        <div className="support-card">
          <span className="support-icon">
            <CircleHelp size={17} />
          </span>
          <strong>Need a hand?</strong>
          <p>Explore your plan at your own pace.</p>
          <a href="#guidance">
            See plan notes <ArrowRight size={13} />
          </a>
        </div>
        <div className="profile-row">
          <span className="profile-avatar">AM</span>
          <span className="profile-copy">
            <strong>Sample user</strong>
            <small>Demo profile</small>
          </span>
          <MoreHorizontal size={18} />
        </div>
      </div>
    </aside>
  );
}

export default function Home() {
  const [finance, setFinance] = useState(initialFinance);
  const [goalType, setGoalType] = useState("home");
  const goalSettings =
    goalType === "home"
      ? { title: "A place to call yours", rate: 11.5, term: 240 }
      : { title: "A car that moves you", rate: 13.5, term: 72 };
  const result = useMemo(
    () =>
      calculateAffordability({
        ...finance,
        annualRatePercent: goalSettings.rate,
        termMonths: goalSettings.term,
      }),
    [finance, goalSettings.rate, goalSettings.term],
  );

  const updateFinance = (key, value) =>
    setFinance((current) => ({ ...current, [key]: Math.max(0, value) }));

  const setGoal = (type) => {
    const settings =
      type === "home"
        ? { goalPrice: 2100000, depositPercent: 10 }
        : { goalPrice: 425000, depositPercent: 15 };
    setGoalType(type);
    setFinance((current) => ({ ...current, ...settings }));
  };

  const goalProgress = Math.min(
    100,
    Math.max(
      0,
      result.estimatedPayment > 0
        ? (result.monthlyCapacityAfterPaydown / result.estimatedPayment) * 100
        : 0,
    ),
  );
  const barWidth = (value) =>
    `${Math.min(
      100,
      finance.takeHomeIncome > 0 ? (value / finance.takeHomeIncome) * 100 : 0,
    )}%`;

  return (
    <div className="app-shell" id="overview">
      <Sidebar />
      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Personal plan</span>
            <span className="crumb-slash">/</span>
            <strong>Overview</strong>
          </div>
          <div className="topbar-actions">
            <span className="demo-pill">
              <span /> Demo data
            </span>
            <span className="market-pill">
              South Africa <ChevronDown size={13} />
            </span>
            <button className="icon-button" aria-label="Notifications">
              <Bell size={18} />
              <i />
            </button>
            <span className="top-avatar">AM</span>
          </div>
        </header>

        <div className="dashboard-content">
          <section className="welcome-row">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-line" /> YOUR MONEY, IN MOTION
              </div>
              <h1>
                Make room for
                <br className="mobile-break" /> what&apos;s next.
              </h1>
              <p className="welcome-copy">
                A clearer view of your debt today, and the goals you&apos;re working toward.
              </p>
            </div>
            <Link className="button button-dark" href="/account">
              <Plus size={16} /> Account &amp; payments
            </Link>
          </section>

          <section className="stats-grid" aria-label="Financial overview">
            <article className="stat-card">
              <div className="stat-top">
                <span>Total debt balance</span>
                <span className="stat-icon peach">
                  <CreditCard size={16} />
                </span>
              </div>
              <strong className="stat-value">
                {formatMoney(finance.debtBalance)}
              </strong>
              <div className="stat-foot">
                <span className="dot dot-terracotta" /> Across your current accounts
              </div>
            </article>
            <article className="stat-card">
              <div className="stat-top">
                <span>Monthly take-home</span>
                <span className="stat-icon sage">
                  <Wallet size={16} />
                </span>
              </div>
              <strong className="stat-value">
                {formatMoney(finance.takeHomeIncome)}
              </strong>
              <div className="stat-foot">
                <span className="dot dot-green" /> After tax and deductions
              </div>
            </article>
            <article className="stat-card dti-card">
              <div className="stat-top">
                <span>Debt-to-income</span>
                <span className="stat-icon lilac">
                  <SlidersHorizontal size={16} />
                </span>
              </div>
              <strong className="stat-value">
                {formatPercent(result.debtToIncomeRatio)}
              </strong>
              <div className="stat-foot">
                <span className="dot dot-blue" /> Debt payments ÷ gross income
              </div>
            </article>
          </section>

          <div className="content-grid">
            <div className="main-column">
              <section className="goal-card" id="goal">
                <div className="goal-card-top">
                  <div>
                    <div className="card-kicker">
                      <span className="goal-kicker-dot" /> YOUR NEXT BIG THING
                    </div>
                    <h2>{goalSettings.title}</h2>
                    <p className="muted-copy">
                      See how your current plan could make it possible.
                    </p>
                  </div>
                  <button className="more-button" aria-label="More goal options">
                    <MoreHorizontal size={19} />
                  </button>
                </div>
                <div className="goal-tabs" role="group" aria-label="Choose a goal">
                  <button
                    className={goalType === "home" ? "goal-tab selected" : "goal-tab"}
                    onClick={() => setGoal("home")}
                  >
                    <House size={15} /> Home
                  </button>
                  <button
                    className={goalType === "car" ? "goal-tab selected" : "goal-tab"}
                    onClick={() => setGoal("car")}
                  >
                    <CarFront size={16} /> Car
                  </button>
                  <button
                    className="goal-tab disabled-tab"
                    disabled
                    title="More goal types coming soon"
                  >
                    <Plus size={15} /> Other
                  </button>
                </div>
                <div className="goal-inputs">
                  <NumberField
                    label="Purchase price"
                    value={finance.goalPrice}
                    onChange={(value) => updateFinance("goalPrice", value)}
                  />
                  <NumberField
                    label="Deposit"
                    value={finance.depositPercent}
                    prefix="%"
                    onChange={(value) =>
                      updateFinance("depositPercent", Math.min(100, value))
                    }
                    hint={`${formatMoney(
                      (finance.goalPrice * finance.depositPercent) / 100,
                    )} upfront`}
                  />
                  <div className="loan-term">
                    <span className="field-label">Illustrative loan term</span>
                    <strong>{goalSettings.term / 12} years</strong>
                    <span className="field-hint">
                      At an assumed {goalSettings.rate}% annual rate
                    </span>
                  </div>
                </div>
                <div className="goal-estimate">
                  <div className="estimate-copy">
                    <span className="estimate-label">
                      ESTIMATED MONTHLY PAYMENT
                    </span>
                    <strong>
                      {formatMoney(result.estimatedPayment)}
                      <small> / month</small>
                    </strong>
                    <span className="estimate-note">
                      Illustrative repayment on {formatMoney(result.loanAmount)}{" "}
                      financed
                    </span>
                  </div>
                  <div className="estimate-divider" />
                  <div className="estimate-status">
                    <span className="status-icon">
                      {result.estimatedGoalFits ? (
                        <Check size={16} />
                      ) : (
                        <ArrowUpRight size={16} />
                      )}
                    </span>
                    <div>
                      <strong>
                        {result.loanAmount === 0
                          ? "Add a purchase amount"
                          : result.estimatedGoalFits
                          ? "Within your modeled room"
                          : "A little more room needed"}
                      </strong>
                      <span>
                        {result.loanAmount === 0
                          ? "Enter a price and deposit to explore"
                          : result.estimatedGoalFits
                          ? `${formatMoney(
                              result.monthlyCapacityAfterPaydown -
                                result.estimatedPayment,
                            )} estimated monthly margin`
                          : `${formatMoney(
                              result.paymentGap,
                            )} monthly gap in this scenario`}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="goal-meta-row">
                  <div>
                    <span>Modeled financing ceiling</span>
                    <strong>{formatMoney(result.supportedLoanAmount)}</strong>
                  </div>
                  <div>
                    <span>Debt-to-income after scenario</span>
                    <strong>{formatPercent(result.projectedDebtToIncomeRatio)}</strong>
                  </div>
                </div>
                <p className="assumption-note">
                  Estimate excludes rates, fees, insurance, and other ownership
                  costs. Actual lending terms vary.
                </p>
              </section>

              <section className="scenario-card" id="scenario">
                <div className="section-heading">
                  <div>
                    <div className="card-kicker">
                      <span className="scenario-kicker-icon">
                        <Sparkles size={13} />
                      </span>{" "}
                      SCENARIO PLANNER
                    </div>
                    <h2>What if you paid down more?</h2>
                    <p className="muted-copy">
                      Adjust your six-month debt payoff target to explore the
                      difference.
                    </p>
                  </div>
                  <span className="scenario-badge">
                    <Clock3 size={13} /> 6 month scenario
                  </span>
                </div>
                <div className="slider-heading">
                  <span>Debt balance paid down</span>
                  <strong>{finance.payoffPercent}%</strong>
                </div>
                <input
                  className="range-slider"
                  type="range"
                  min="0"
                  max="60"
                  step="5"
                  value={finance.payoffPercent}
                  style={{
                    "--range-progress": `${(finance.payoffPercent / 60) * 100}%`,
                  }}
                  onChange={(event) =>
                    updateFinance("payoffPercent", Number(event.target.value))
                  }
                  aria-label="Percentage of debt balance to pay down in six months"
                />
                <div className="range-labels">
                  <span>0% · Keep current pace</span>
                  <span>60% · Stretch goal</span>
                </div>
                <div className="scenario-results">
                  <div className="scenario-result">
                    <span>Debt balance after payoff</span>
                    <strong>{formatMoney(result.projectedDebtBalance)}</strong>
                    <small>
                      {formatMoney(
                        finance.debtBalance - result.projectedDebtBalance,
                      )}{" "}
                      paid down
                    </small>
                  </div>
                  <div className="scenario-arrow">
                    <ArrowRight size={18} />
                  </div>
                  <div className="scenario-result">
                    <span>Estimated monthly room</span>
                    <strong>
                      {formatMoney(result.monthlyCapacityAfterPaydown)}
                    </strong>
                    <small>After essentials &amp; buffer</small>
                  </div>
                  <div className="scenario-delta">
                    {result.monthlyCapacityAfterPaydown >=
                    result.monthlyCapacityNow ? (
                      <ArrowUpRight size={15} />
                    ) : (
                      <ArrowDownRight size={15} />
                    )}
                    +
                    {formatMoney(
                      result.monthlyCapacityAfterPaydown -
                        result.monthlyCapacityNow,
                    )}
                  </div>
                </div>
                <p className="scenario-footnote">
                  Assumes monthly debt payments fall in proportion to the
                  balance paid down. This is a simplified estimate, not a
                  lender assessment.
                </p>
              </section>

              <section className="cashflow-card">
                <div className="section-heading compact-heading">
                  <div>
                    <div className="card-kicker">A CLOSER LOOK</div>
                    <h2>Your monthly picture</h2>
                  </div>
                  <span className="quiet-label">After six-month paydown</span>
                </div>
                <div className="cashflow-content">
                  <div
                    className="cashflow-bars"
                    aria-label="Illustrative monthly income allocation"
                  >
                    <div className="bar-row">
                      <span>
                        <i className="bar-dot bar-debt" /> Debt repayments
                      </span>
                      <strong>{formatMoney(result.projectedDebtPayment)}</strong>
                    </div>
                    <div className="bar-track">
                      <span
                        className="bar-fill fill-debt"
                        style={{ width: barWidth(result.projectedDebtPayment) }}
                      />
                    </div>
                    <div className="bar-row">
                      <span>
                        <i className="bar-dot bar-expenses" /> Essential expenses
                      </span>
                      <strong>{formatMoney(finance.essentialExpenses)}</strong>
                    </div>
                    <div className="bar-track">
                      <span
                        className="bar-fill fill-expenses"
                        style={{ width: barWidth(finance.essentialExpenses) }}
                      />
                    </div>
                    <div className="bar-row">
                      <span>
                        <i className="bar-dot bar-room" /> Estimated room for a
                        goal
                      </span>
                      <strong>
                        {formatMoney(result.monthlyCapacityAfterPaydown)}
                      </strong>
                    </div>
                    <div className="bar-track">
                      <span
                        className="bar-fill fill-room"
                        style={{
                          width: barWidth(result.monthlyCapacityAfterPaydown),
                        }}
                      />
                    </div>
                  </div>
                  <div className="cashflow-side">
                    <div
                      className="donut"
                      style={{ "--donut-value": `${goalProgress}%` }}
                    >
                      <div>
                        <strong>{Math.round(goalProgress)}%</strong>
                        <span>
                          of payment
                          <br />
                          covered
                        </span>
                      </div>
                    </div>
                    <span className="donut-caption">
                      Modeled monthly room vs. goal payment
                    </span>
                  </div>
                </div>
              </section>
            </div>

            <aside className="right-column">
              <section className="snapshot-card" id="snapshot">
                <div className="side-card-heading">
                  <div>
                    <span className="card-kicker">YOUR STARTING POINT</span>
                    <h2>Money snapshot</h2>
                  </div>
                  <span className="edit-dot">
                    <span />
                  </span>
                </div>
                <p className="muted-copy snapshot-intro">
                  Edit the sample figures to explore your own scenario.
                </p>
                <div className="snapshot-fields">
                  <NumberField
                    label="Gross monthly income"
                    value={finance.grossIncome}
                    onChange={(value) => updateFinance("grossIncome", value)}
                  />
                  <NumberField
                    label="Take-home income"
                    value={finance.takeHomeIncome}
                    onChange={(value) => updateFinance("takeHomeIncome", value)}
                  />
                  <NumberField
                    label="Total debt balance"
                    value={finance.debtBalance}
                    onChange={(value) => updateFinance("debtBalance", value)}
                  />
                  <NumberField
                    label="Monthly debt payments"
                    value={finance.monthlyDebtPayment}
                    onChange={(value) =>
                      updateFinance("monthlyDebtPayment", value)
                    }
                  />
                  <NumberField
                    label="Essential monthly expenses"
                    value={finance.essentialExpenses}
                    onChange={(value) =>
                      updateFinance("essentialExpenses", value)
                    }
                  />
                  <NumberField
                    label="Monthly safety buffer"
                    value={finance.monthlyBuffer}
                    onChange={(value) => updateFinance("monthlyBuffer", value)}
                    hint="Kept aside before estimating goal room"
                  />
                </div>
                <div className="privacy-note">
                  <LockKeyhole size={14} />
                  <span>
                    Your entries stay in this browser session and aren&apos;t sent
                    to a service.
                  </span>
                </div>
                <button
                  className="reset-button"
                  onClick={() => {
                    setFinance(initialFinance);
                    setGoalType("home");
                  }}
                >
                  Reset to demo values
                </button>
              </section>

              <section className="timeline-card">
                <div className="side-card-heading">
                  <div>
                    <span className="card-kicker">A POSSIBLE PATH</span>
                    <h2>Next steps</h2>
                  </div>
                  <button
                    className="tiny-icon-button"
                    aria-label="More information"
                    title="Illustrative steps, not personal financial advice"
                  >
                    <CircleHelp size={16} />
                  </button>
                </div>
                <div className="timeline">
                  <div className="timeline-item">
                    <span className="timeline-marker completed">
                      <Check size={12} />
                    </span>
                    <div>
                      <span className="timeline-time">START HERE</span>
                      <strong>Know your numbers</strong>
                      <p>
                        Review your income, balances, and monthly commitments.
                      </p>
                    </div>
                  </div>
                  <div className="timeline-item">
                    <span className="timeline-marker">
                      <span />
                    </span>
                    <div>
                      <span className="timeline-time">NEXT 6 MONTHS</span>
                      <strong>Work toward your payoff target</strong>
                      <p>
                        Planned paydown:{" "}
                        {formatMoney(
                          (finance.debtBalance * finance.payoffPercent) / 100,
                        )}{" "}
                        across your listed debts.
                      </p>
                    </div>
                  </div>
                  <div className="timeline-item last">
                    <span className="timeline-marker">
                      <span />
                    </span>
                    <div>
                      <span className="timeline-time">THEN</span>
                      <strong>Re-check the full cost</strong>
                      <p>
                        Compare updated payments with your budget before making
                        a commitment.
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="insight-card" id="guidance">
                <div className="insight-icon">
                  <Lightbulb size={17} />
                </div>
                <div>
                  <span className="card-kicker">A NOTE FOR YOUR PLAN</span>
                  <p>
                    {result.estimatedGoalFits
                      ? `In this scenario, the estimated payment is within your modeled monthly room by ${formatMoney(
                          result.monthlyCapacityAfterPaydown -
                            result.estimatedPayment,
                        )}. Keep a buffer for costs not included here.`
                      : `This goal is about ${formatMoney(
                          result.paymentGap,
                        )} above your modeled monthly room. You could explore a lower target price or a larger deposit, then compare again.`}
                  </p>
                  <span className="insight-disclaimer">
                    <Sparkles size={12} /> Generated from your demo inputs
                  </span>
                </div>
              </section>
            </aside>
          </div>
          <footer className="disclaimer">
            <LockKeyhole size={14} />
            <p>
              <strong>For planning only.</strong> These simplified estimates are
              not financial advice, credit decisions, or a promise of approval.
              Actual lender criteria, rates, fees, insurance, taxes, and
              affordability assessments vary. Verify details with qualified
              providers before making financial decisions.
            </p>
          </footer>
        </div>
      </main>
    </div>
  );
}
