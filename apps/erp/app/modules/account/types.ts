// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { getAccount, getPublicAttributes } from "./account.service";

export type Account = NonNullable<
  Awaited<ReturnType<typeof getAccount>>["data"]
>;

export type PersonalData = {};

export type PublicAttributes = NonNullable<
  Awaited<ReturnType<typeof getPublicAttributes>>["data"]
>[number];

export type PrivateAttributes = PublicAttributes;
