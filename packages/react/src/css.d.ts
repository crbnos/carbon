// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Side-effect CSS imports are resolved by the consuming app's bundler, not by tsc.
declare module "*.css";

// `?inline` imports give the stylesheet's text, for a <style> React renders.
declare module "*.css?inline" {
  const css: string;
  export default css;
}
