// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

const modules = [
  "Accounting",
  "Documents",
  "Inventory",
  "Invoicing",
  "Parts",
  "Production",
  "Purchasing",
  "Resources",
  "Sales",
  "Settings",
  "Users"
] as const;

export type Module = (typeof modules)[number];

export { modules };
