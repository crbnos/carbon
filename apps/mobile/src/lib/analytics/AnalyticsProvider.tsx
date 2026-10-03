// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { PostHogProvider } from "posthog-react-native";
import type { ReactNode } from "react";
import { useAuth } from "~/lib/auth/AuthProvider";
import { analyticsDecision } from "./policy";

/**
 * PostHog, mounted only when `analyticsDecision` allows it.
 *
 * The gate is structural rather than a flag passed to the SDK: when analytics
 * is off, `PostHogProvider` is not rendered at all, so there is no client, no
 * queue and no socket that a later code path could accidentally flush. A
 * `disabled` prop would leave an initialised client one bug away from sending
 * a controlled environment's job ids to a third party.
 *
 * It also sits BELOW AuthProvider on purpose: the api key and host arrive with
 * `/me`, because nothing at a public path describes a Carbon.
 */
export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const decision = analyticsDecision(me);

  if (!decision.enabled) return <>{children}</>;

  return (
    <PostHogProvider
      apiKey={decision.apiKey}
      options={{ host: decision.host }}
      // Screen names on a shop floor are job and operation ids; autocapture
      // would ship them without anyone deciding to.
      autocapture={false}
    >
      {children}
    </PostHogProvider>
  );
}
