export function getIntegrationStatus() {
  return {
    openBanking: {
      status: "not_configured",
      provider: null,
    },
    lenderDirectory: {
      status: "no_verified_partners",
      partnerCount: 0,
    },
    coaching: {
      status: "rules_based",
      externalLlmEnabled: false,
    },
  };
}
