import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateAffordability,
  loanPrincipalForPayment,
  monthlyLoanPayment,
} from "./affordability.js";

const baseline = {
  grossIncome: 68500,
  takeHomeIncome: 52700,
  monthlyDebtPayment: 12100,
  essentialExpenses: 21000,
  monthlyBuffer: 2500,
  debtBalance: 182000,
  payoffPercent: 30,
  goalPrice: 2100000,
  depositPercent: 10,
  annualRatePercent: 11.5,
  termMonths: 240,
};

test("calculates a level monthly payment and reverses it to principal", () => {
  const payment = monthlyLoanPayment(500000, 12, 60);
  assert.ok(payment > 11000 && payment < 11200);
  assert.ok(Math.abs(loanPrincipalForPayment(payment, 12, 60) - 500000) < 0.01);
});

test("handles interest-free loans and empty terms", () => {
  assert.equal(monthlyLoanPayment(12000, 0, 12), 1000);
  assert.equal(monthlyLoanPayment(12000, 10, 0), 0);
  assert.equal(loanPrincipalForPayment(1000, 0, 12), 12000);
});

test("projects lower debt pressure and higher monthly capacity after paydown", () => {
  const result = calculateAffordability(baseline);
  assert.equal(result.debtToIncomeRatio, (12100 / 68500) * 100);
  assert.ok(result.projectedDebtToIncomeRatio < result.debtToIncomeRatio);
  assert.equal(result.monthlyCapacityNow, 17100);
  assert.equal(result.monthlyCapacityAfterPaydown, 20730);
  assert.ok(Math.abs(result.projectedDebtBalance - 127400) < 0.01);
});

test("safely handles zero income and clamps invalid negative amounts", () => {
  const result = calculateAffordability({
    ...baseline,
    grossIncome: 0,
    takeHomeIncome: -1,
    debtBalance: -50,
    payoffPercent: 140,
  });
  assert.equal(result.debtToIncomeRatio, 0);
  assert.equal(result.monthlyCapacityNow, 0);
  assert.equal(result.projectedDebtBalance, 0);
  assert.equal(result.estimatedGoalFits, false);
});
