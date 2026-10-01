// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Page/record context the agent is given each turn. Only identifiers + a human label
 * are sent — never full record data; the agent fetches details on demand via read tools.
 *
 * Canonical definition: `useBrowsingContext` (client) derives it from the route, and
 * `agent.models.ts` validates the wire shape against it (`browsingContext` schema).
 */
export type BrowsingContext = {
  route: string;
  object?: string;
  id?: string;
  type?: "record" | "list";
  label: string;
};
