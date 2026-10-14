// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Rule queries shared with MES are NOT re-exported here — import them from
// `@carbon/ee/rules` directly so the package boundary stays visible at the
// call site (this module owns only the ERP-side admin CRUD + validators).
export * from "./inventory.models";
export * from "./inventory.service";
export * from "./types";
export * from "./ui";
