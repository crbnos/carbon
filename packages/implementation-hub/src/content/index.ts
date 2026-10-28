// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Code-owned template content. A hub row pins its lineage via templateKey +
// templateVersion; bump TEMPLATE_VERSION when the structure changes materially.
export const TEMPLATE_KEY = "standard";
// Version 2 (2026-10): Setup Map in dependency order, operational tasks,
// objectives, customization plan. Existing hubs were moved to 2 by migration.
export const TEMPLATE_VERSION = 2;

export * from "./board";
export * from "./copy";
export * from "./customization";
export * from "./dependencies";
export * from "./evidence";
export * from "./golive";
export * from "./handover";
export * from "./objectives";
export * from "./operational";
export * from "./page";
export * from "./priority-set";
export * from "./registry";
export * from "./requirements";
export * from "./scope";
export * from "./spine";
