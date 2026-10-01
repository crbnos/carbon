// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// This package ships raw source compiled by the consuming app's Vite build.
// Type the Vite-injected globals the source references without depending on
// vite (typecheck runs standalone via tsgo).
declare module "*.wasm?url" {
  const url: string;
  export default url;
}
