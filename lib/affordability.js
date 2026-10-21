const nonNegative = (value) => Math.max(0, Number(value) || 0);

export function monthlyLoanPayment(principal, annualRatePercent, termMonths) {
  const amount = nonNegative(principal);
  const months = Math.max(0, Math.floor(Number(termMonths) || 0));
  const monthlyRate = nonNegative(annualRatePercent) / 100 / 12;

  if (amount === 0 || months === 0) return 0;
  if (monthlyRate === 0) return amount / months;

  const growth = (1 + monthlyRate) ** months;
  return (amount * monthlyRate * growth) / (growth - 1);
}

export function loanPrincipalForPayment(payment, annualRatePercent, termMonths) {
  const monthlyPayment = nonNegative(payment);
  const months = Math.max(0, Math.floor(Number(termMonths) || 0));
  const monthlyRate = nonNegative(annualRatePercent) / 100 / 12;

  if (monthlyPayment === 0 || months === 0) return 0;
  if (monthlyRate === 0) return monthlyPayment * months;

  return (
    (monthlyPayment * (1 - (1 + monthlyRate) ** -months)) /
    monthlyRate
  );
}

export function calculateAffordability(input) {
  const grossIncome = nonNegative(input.grossIncome);
  const takeHomeIncome = nonNegative(input.takeHomeIncome);
  const monthlyDebtPayment = nonNegative(input.monthlyDebtPayment);
  const essentialExpenses = nonNegative(input.essentialExpenses);
  const monthlyBuffer = nonNegative(input.monthlyBuffer);
  const debtBalance = nonNegative(input.debtBalance);
  const payoffPercent = Math.min(100, nonNegative(input.payoffPercent));
  const termMonths = Math.max(0, Math.floor(Number(input.termMonths) || 0));
  const annualRatePercent = nonNegative(input.annualRatePercent);
  const goalPrice = nonNegative(input.goalPrice);
  const depositPercent = Math.min(100, nonNegative(input.depositPercent));

  const debtToIncomeRatio =
    grossIncome > 0 ? (monthlyDebtPayment / grossIncome) * 100 : 0;
  const projectedDebtPayment =
    monthlyDebtPayment * (1 - payoffPercent / 100);
  const monthlyCapacityNow = Math.max(
    0,
    takeHomeIncome -
      essentialExpenses -
      monthlyDebtPayment -
      monthlyBuffer,
  );
  const monthlyCapacityAfterPaydown = Math.max(
    0,
    takeHomeIncome -
      essentialExpenses -
      projectedDebtPayment -
      monthlyBuffer,
  );
  const projectedDebtToIncomeRatio =
    grossIncome > 0 ? (projectedDebtPayment / grossIncome) * 100 : 0;
  const loanAmount = goalPrice * (1 - depositPercent / 100);
  const estimatedPayment = monthlyLoanPayment(
    loanAmount,
    annualRatePercent,
    termMonths,
  );
  const supportedLoanAmount = loanPrincipalForPayment(
    monthlyCapacityAfterPaydown,
    annualRatePercent,
    termMonths,
  );

  return {
    debtToIncomeRatio,
    projectedDebtToIncomeRatio,
    projectedDebtPayment,
    monthlyCapacityNow,
    monthlyCapacityAfterPaydown,
    loanAmount,
    estimatedPayment,
    supportedLoanAmount,
    paymentGap: Math.max(0, estimatedPayment - monthlyCapacityAfterPaydown),
    estimatedGoalFits:
      estimatedPayment <= monthlyCapacityAfterPaydown && loanAmount > 0,
    projectedDebtBalance: debtBalance * (1 - payoffPercent / 100),
  };
}
