import type { ConformanceCheck, Violation } from "../check";

// Integration ids are DATA, not control flow. Which integrations are accounting
// providers was answered five different ways before `providerRole` existed —
// three hard-coded id arrays, a display-category string test, and an
// `.eq("id","ramp")` — and each one silently excluded any provider added later.
//
// Ask the registry instead: `getIntegrationsByRole` / `getIntegrationIdsByRole`
// (`@carbon/ee`), or the resolved `IntegrationTopology`.
const INTEGRATION_IDS = [
  "xero",
  "quickbooks",
  "rillet",
  "ramp",
  "slack",
  "jira",
  "linear",
  "onshape",
  "paperless-parts",
  "email",
  "sage",
  "stripe-connect"
];

const quoted = INTEGRATION_IDS.map((id) => `["']${id}["']`).join("|");

/** `x === "ramp"`, `x !== "ramp"` — a branch on identity. */
const COMPARISON = new RegExp(`[!=]==?\\s*(?:${quoted})`, "g");

/** `["xero", "quickbooks"]` / `new Set(["ramp", …])` — an ad-hoc membership list. */
const ID_LIST = new RegExp(`(?:${quoted})\\s*,\\s*(?:${quoted})`, "g");

/**
 * Files that are legitimately id-keyed: the registry itself, a provider naming
 * ITSELF, and the maps whose whole purpose is per-id data (secret keys, server
 * hooks, error copy).
 */
const EXCLUDED = [
  /^packages\/ee\/src\/index\.ts$/,
  /^packages\/ee\/src\/hooks\.server\.ts$/,
  /^packages\/ee\/src\/integrations\/secrets\.ts$/,
  /^packages\/ee\/src\/sync\//,
  /^apps\/erp\/app\/modules\/settings\/integration-errors\.ts$/,
  // A provider's own directory may name itself.
  /^packages\/ee\/src\/(xero|quickbooks|rillet|ramp|slack|jira|linear|onshape|paperless-parts|email|sage|stripe-connect)\//
];

export const noIntegrationIdBranching: ConformanceCheck = {
  id: "no-integration-id-branching",
  description:
    "Branch on an integration's declared providerRole or the resolved topology, never on its id",
  provenance: {
    deprecates:
      "hard-coded integration-id comparisons and ad-hoc id arrays outside the registry",
    replacedBy:
      "providerRole + getIntegrationsByRole/getIntegrationIdsByRole (@carbon/ee) or IntegrationTopology",
    since: "20260924133915_integration-provider-role.sql"
  },
  scan(file: string, contents: string): Violation[] {
    if (EXCLUDED.some((pattern) => pattern.test(file))) return [];

    const violations: Violation[] = [];
    contents.split("\n").forEach((text, i) => {
      for (const pattern of [COMPARISON, ID_LIST]) {
        pattern.lastIndex = 0;
        for (const match of text.matchAll(pattern)) {
          violations.push({
            file,
            line: i + 1,
            snippet: match[0],
            message:
              "Branching on an integration id excludes every provider added later — ask the registry for the role instead (getIntegrationIdsByRole / IntegrationTopology)."
          });
        }
      }
    });
    return violations;
  }
};
