// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck } from "../check";
import { typescript } from "../sources/inputs";

// Integration ids are DATA, not control flow. Which integrations are accounting
// providers was answered five different ways before `providerRole` existed —
// three hard-coded id arrays, a display-category string test, and an
// `.eq("id","ramp")` — and each one silently excluded any provider added later.
//
// Ask the registry instead: `getIntegrationsByRole` / `getIntegrationIdsByRole`
// (`@carbon/ee`), or the resolved `IntegrationTopology`.
export const noIntegrationIdBranching = defineCheck({
  files: typescript,
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
  // The patterns are built from the list of ids, so `bans()` builds them when
  // the check first runs.
  bans() {
    const quoted = [
      "xero",
      "quickbooks",
      "rillet",
      "ramp",
      "sense",
      "slack",
      "jira",
      "linear",
      "onshape",
      "onshape-government",
      "onshape-v2-government",
      "paperless-parts",
      "email",
      "sage",
      "stripe-connect"
    ]
      .map((id) => `["']${id}["']`)
      .join("|");
    const message =
      "Branching on an integration id excludes every provider added later — ask the registry for the role instead (getIntegrationIdsByRole / IntegrationTopology).";
    return {
      within: "line",
      snippet: "match",
      banned: [
        // `x === "ramp"`, `x !== "ramp"` — a branch on identity.
        { pattern: new RegExp(`[!=]==?\\s*(?:${quoted})`, "g"), message },
        // `["xero", "quickbooks"]` / `new Set(["ramp", …])` — an ad-hoc membership list.
        {
          pattern: new RegExp(`(?:${quoted})\\s*,\\s*(?:${quoted})`, "g"),
          message
        }
      ],
      // Both patterns need a quoted id, so a file or line without one is skipped.
      mayContain: new RegExp(quoted),
      // Files that are legitimately id-keyed: the registry itself, a provider
      // naming ITSELF, and the maps whose whole purpose is per-id data (secret
      // keys, server hooks, error copy).
      except: [
        "packages/ee/src/index.ts",
        "packages/ee/src/hooks.server.ts",
        "packages/ee/src/integrations/secrets.ts",
        /^packages\/ee\/src\/sync\//,
        // The issue-tracker sync engine dispatches each linked issue to its
        // tracker, as the accounting sync engine does to its provider.
        /^packages\/ee\/src\/issue-sync\//,
        "apps/erp/app/modules/settings/integration-errors.ts",
        // A provider's own directory may name itself.
        /^packages\/ee\/src\/(xero|quickbooks|rillet|ramp|slack|jira|linear|onshape|paperless-parts|email|sage|stripe-connect|sense)\//
      ]
    };
  }
});
