// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "../..");
const mesCoreSrc = path.resolve(repoRoot, "packages/mes-core/src");
const utilsSrc = path.resolve(repoRoot, "packages/utils/src");
// Only the PURE geometry modules of the viewer are reachable from here —
// `fallback`, `graph` and `types` import nothing but each other's types. The
// package barrel and `motion.ts` pull in three.js and react-three-fiber, so
// they must never be imported: the alias is deliberately deep-path only.
const viewerSrc = path.resolve(repoRoot, "packages/viewer/src");
// @carbon/utils/precision re-exports this path by design (the edge runtime only
// mounts supabase/functions/), so Metro has to be able to reach it.
const precisionSrc = path.resolve(
  repoRoot,
  "packages/database/supabase/functions/shared"
);

const config = getDefaultConfig(projectRoot);

/**
 * Shared Carbon source, compiled by Metro like the app's own files.
 *
 * apps/mobile is NOT a pnpm workspace member (see the repo's pnpm-workspace.yaml:
 * the web tree is pinned to React 18 and a pnpm override has no per-package
 * escape). So `@carbon/mes-core` cannot be a `workspace:*` dependency — it is
 * shared as SOURCE instead. Metro compiles its TypeScript like any other file in
 * the app, which is exactly what it was written for: zod plus type-only imports,
 * no React, no Node, no server env.
 *
 * Two things that follow:
 *   - repoRoot must be watched, or edits to mes-core do not trigger a reload.
 *   - resolution for the alias must NOT fall back to the repo's root
 *     node_modules, or Metro would pull React 18 in beside the app's React 19.
 *     nodeModulesPaths therefore lists ONLY this app's own node_modules.
 */
config.watchFolders = [mesCoreSrc, utilsSrc, precisionSrc, viewerSrc];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];
config.resolver.disableHierarchicalLookup = true;
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "@carbon/mes-core": mesCoreSrc,
  // Only the import-light subpaths are used (status-colors, format, date,
  // datetime). NEVER the @carbon/utils barrel: it pulls in tiptap, dompurify
  // and cookie helpers, none of which belong in a React Native bundle.
  "@carbon/utils": utilsSrc,
  "@carbon/viewer": viewerSrc
};

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
  dtsFile: "./src/uniwind-types.d.ts"
});
