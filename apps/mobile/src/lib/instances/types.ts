// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MeInstance } from "@carbon/mes-core";

/**
 * A linked Carbon. Instances are first class: one tablet may hold production
 * and staging, or two different customers' servers, and ALL app state hangs off
 * one of them — the session, the chosen company and location, the query cache
 * and the outbox.
 */
export type Instance = {
  id: string;
  /** The origin `/api/v1` is called on. */
  serverUrl: string;
  scheme: "https" | "http";
  linkedAt: string;
  /**
   * What `GET /me` returned, available only AFTER sign-in. Before that the app
   * knows nothing about this server but its address — there is deliberately no
   * public endpoint that describes a Carbon (spec Q15).
   */
  details: MeInstance | null;
};

export function instanceLabel(instance: Instance): string {
  if (instance.details?.name) return instance.details.name;
  try {
    return new URL(instance.serverUrl).host;
  } catch {
    return instance.serverUrl;
  }
}
