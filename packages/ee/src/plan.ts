import { Plan } from "@carbon/utils";
import type { IntegrationID } from "./index";

/**
 * Source of truth: which plans grant which feature. Both client
 * (`usePlanGate`) and server (`plan.server.ts`) read from here.
 */
export const FEATURE_PLANS = {
  API_KEYS: [Plan.Business, Plan.Partner],
  WEBHOOKS: [Plan.Business, Plan.Partner],
  INTEGRATIONS: [Plan.Business, Plan.Partner],
  SALES_RULES: [Plan.Business, Plan.Partner],
  AUDIT_LOG: [Plan.Business, Plan.Partner],
  EMAIL_NOTIFICATIONS: [Plan.Business, Plan.Partner],
  STORAGE_RULES: [Plan.Business, Plan.Partner],
  CUSTOMER_PORTALS: [Plan.Business, Plan.Partner],
  AI_AGENT: [Plan.Business, Plan.Partner],
  WORKFLOWS: [Plan.Business, Plan.Partner],
  FORECAST: [Plan.Business, Plan.Partner],
  TWO_FACTOR: [Plan.Business, Plan.Partner],
  // Authoring RBAC — creating/editing employee types, editing an individual
  // user's permissions, and console (kiosk) mode. Community ships an
  // "everyone is an admin" experience: you can add users but not author roles
  // or modify permissions.
  PERMISSIONS: [Plan.Business, Plan.Partner],
  // Tiered document-approval rules (POs by amount, quality docs, suppliers).
  APPROVAL_RULES: [Plan.Business, Plan.Partner],
  // Company backup / restore (self-service export + restore of company data).
  BACKUPS: [Plan.Business, Plan.Partner]
} as const satisfies Record<string, Plan[]>;

export type Feature = keyof typeof FEATURE_PLANS;

/**
 * Integration ids that bypass the `INTEGRATIONS` plan gate. Add ids here for
 * integrations that should remain available on every plan.
 */
export const INTEGRATION_WHITELIST = new Set<IntegrationID>(["email"]);

export function isIntegrationWhitelisted(id: string) {
  return INTEGRATION_WHITELIST.has(id as IntegrationID);
}

export type PlanRequirement = Plan | Plan[];

export type GateSpec =
  | { feature: Feature; plan?: never }
  | { feature?: never; plan: PlanRequirement };

export function resolveRequirement(spec: GateSpec): Plan[] {
  if (spec.feature) return [...FEATURE_PLANS[spec.feature]];
  return Array.isArray(spec.plan) ? spec.plan : [spec.plan];
}

export function planMeetsRequirement(
  current: Plan,
  requirement: Plan[]
): boolean {
  if (requirement.length === 0) return true;
  return requirement.includes(current);
}

export function defaultUpgradeMessage(requirement: Plan[]): string {
  if (requirement.length === 1 && requirement[0] === Plan.Business) {
    return "Upgrade to the Business plan to enable this feature.";
  }
  return "Upgrade your plan to enable this feature.";
}
