// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Fetcher } from "react-router";

/**
 * What a switch shows for a setting it saves on change: the value being saved
 * while that request is in flight, otherwise the saved value.
 *
 * Nothing is copied into state. A switch that kept its own copy flipped on
 * click and never read the setting again, so a save that failed left it in the
 * position that was clicked.
 *
 * `intent` is the `intent` the switch submits with `enabled: "true" | "false"`.
 */
export function useSavedToggle(
  fetcher: Fetcher,
  intent: string,
  saved: boolean
): boolean {
  const pending =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === intent
      ? fetcher.formData.get("enabled") === "true"
      : undefined;
  return pending ?? saved;
}
