// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MeResponse } from "@carbon/mes-core";

/**
 * Whether this app may talk to PostHog at all.
 *
 * AGENTS.md: "Never make an outbound request to any host but the linked
 * instance's own before sign-in, or at all when /me reports
 * controlledEnvironment or mode: airgapped." Analytics is the one feature that
 * would do exactly that, so the decision is a pure function with its own tests
 * rather than a condition inside a provider — a defect here sends a
 * defence-contractor's job ids to a third party, and there is no undoing that.
 *
 * `analytics` is already null on self-hosted, air-gapped and controlled
 * installs, so in principle the key alone is enough. The other two are checked
 * anyway: one server that returns a key it should not have must not be able to
 * turn telemetry on, and the cost of the redundancy is three comparisons.
 */
export type AnalyticsDecision =
  | { enabled: true; apiKey: string; host: string }
  | { enabled: false; reason: AnalyticsBlockReason };

export type AnalyticsBlockReason =
  | "not_signed_in"
  | "airgapped"
  | "controlled_environment"
  | "not_configured";

export function analyticsDecision(
  me: MeResponse | null | undefined
): AnalyticsDecision {
  if (!me) return { enabled: false, reason: "not_signed_in" };

  const instance = me.instance;
  if (instance.mode === "airgapped") {
    return { enabled: false, reason: "airgapped" };
  }
  if (instance.controlledEnvironment) {
    return { enabled: false, reason: "controlled_environment" };
  }
  if (!instance.analytics?.posthogKey || !instance.analytics?.posthogHost) {
    return { enabled: false, reason: "not_configured" };
  }

  return {
    enabled: true,
    apiKey: instance.analytics.posthogKey,
    host: instance.analytics.posthogHost
  };
}
