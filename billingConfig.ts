// Your ACTUAL deployed WattWalker URL
export const DEPLOYED_URL = "https://wattwalker.walkerpowersolar.com";

// Legacy constants for backward compatibility (Mapped to Premium)
export const MONTHLY_PRICE_ID = "price_1T1DVBRTMNcgA09IcxnKX4d7";
export const YEARLY_PRICE_ID  = "price_1T1E1mRTMNcgA09IdWo1QaDE";

// Comprehensive Price ID Map (must be Live-mode price IDs when the Firebase extension uses a live Stripe key)
export const PRICE_IDS = {
  basic: {
    monthly: "price_1T1DPCRTMNcgA09IP0Lpemtu",
    yearly: "price_1T1E33RTMNcgA09IETP6kaMo"
  },
  professional: {
    monthly: "price_1T1DRARTMNcgA09I2L8nE2mB",
    yearly: "price_1T1E2NRTMNcgA09I0TaXKreG"
  },
  premium: {
    monthly: "price_1T1DVBRTMNcgA09IcxnKX4d7",
    yearly: "price_1T1E1mRTMNcgA09IdWo1QaDE"
  }
};

/** Display amounts for the pricing UI (keep in sync with Stripe product prices) */
export const PLAN_DISPLAY_PRICES = {
  basic: { monthly: 5.99, yearly: 59.99 },
  professional: { monthly: 12.99, yearly: 129.99 },
  premium: { monthly: 19.99, yearly: 199.0 }
} as const;

// Helper to detect whether the app uses hash routing.
export function usesHashRouting(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const href = window.location.href || "";
  return href.includes("/#/");
}

// Build success and cancel URLs based on routing type.
export function successUrl(): string {
  if (usesHashRouting()) {
    return `${DEPLOYED_URL}/#/success`;
  }
  return `${DEPLOYED_URL}/success`;
}

export function cancelUrl(): string {
  if (usesHashRouting()) {
    return `${DEPLOYED_URL}/#/failure`;
  }
  return `${DEPLOYED_URL}/failure`;
}