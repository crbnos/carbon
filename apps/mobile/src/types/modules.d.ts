// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Ambient declarations for side-effect imports that ship no types.
 */

// Uniwind's CSS entry is consumed by Metro, not by TypeScript.
declare module "*.css";

// @formatjs ships runtime-only polyfill entry points.
declare module "@formatjs/intl-locale/polyfill-force";
declare module "@formatjs/intl-pluralrules/polyfill-force";
declare module "@formatjs/intl-pluralrules/locale-data/*";
