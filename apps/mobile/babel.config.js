// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The Lingui macro plugin must run so `useLingui()` / `<Trans>` from
 * `@lingui/react/macro` compile to ICU message calls, exactly as the web apps
 * get it from `@lingui/vite-plugin`.
 */
module.exports = (api) => {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: ["@lingui/babel-plugin-lingui-macro"]
  };
};
