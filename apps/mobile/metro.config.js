// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "../..");
const mesCoreSrc = path.resolve(repoRoot, "packages/mes-core/src");

const config = getDefaultConfig(projectRoot);

/**
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
config.watchFolders = [mesCoreSrc];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];
config.resolver.disableHierarchicalLookup = true;
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "@carbon/mes-core": mesCoreSrc
};

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
  dtsFile: "./src/uniwind-types.d.ts"
});
