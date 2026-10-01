// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export type ListItem = {
  id: string;
  name: string;
};

export type PinnedInUser = {
  userId: string;
  name: string;
  avatarUrl: string | null;
};

export type UserContext = {
  locationId: string;
  companyId: string;
  consoleMode: boolean;
  /**
   * Console mode as `userMiddleware` found it for a console session: `true`,
   * or `null` when the settings could not be read (the session is kept). Not
   * checked — `null` — outside console mode.
   */
  consoleEnabled: boolean | null;
  effectiveUserId: string;
  pinnedInUser: PinnedInUser | null;
};
