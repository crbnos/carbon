import { getStripeCustomer, getStripeCustomerId } from "./stripe.server";

// Add new plans here
const defaultPlans = [
  {
    id: "FREE",
    priceId: undefined,
    messageLimit: 10,
  },
  {
    id: "PRO",
    priceId: "price_1R3aDvLxBMFKq9DZn1vkvwwW",
    messageLimit: 100,
  },
];

export async function getPlans() {
  return defaultPlans;
}

export async function getStripePlan(companyId: string) {
  const plans = await getPlans();
  const freePlan = plans.find((plan) => plan.priceId === undefined) ?? plans[0];

  const customerId = await getStripeCustomerId(companyId);
  if (!customerId) {
    return freePlan;
  }

  const subData = await getStripeCustomer(customerId);
  if (!subData || subData.status !== "active") {
    // Inactive subscriptions happen after canceling, once the billing period ends
    return freePlan;
  }

  return plans.find((plan) => plan.priceId === subData.priceId) ?? freePlan;
}
