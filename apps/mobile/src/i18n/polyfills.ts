// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Hermes ships a partial Intl. Lingui needs `Intl.Locale` and
 * `Intl.PluralRules` to select plural forms, and `@internationalized/date`
 * needs `Intl.Locale`. Imported from `/polyfill-force` as Lingui's React Native
 * guide instructs — the feature-detecting entry points are slow to initialise
 * on low-end devices, which is what a shop-floor tablet is.
 *
 * This module must be imported FIRST, before any i18n or date code runs.
 */
import "@formatjs/intl-locale/polyfill-force";
import "@formatjs/intl-pluralrules/polyfill-force";

import "@formatjs/intl-pluralrules/locale-data/de";
import "@formatjs/intl-pluralrules/locale-data/en";
import "@formatjs/intl-pluralrules/locale-data/es";
import "@formatjs/intl-pluralrules/locale-data/fr";
import "@formatjs/intl-pluralrules/locale-data/hi";
import "@formatjs/intl-pluralrules/locale-data/it";
import "@formatjs/intl-pluralrules/locale-data/ja";
import "@formatjs/intl-pluralrules/locale-data/ko";
import "@formatjs/intl-pluralrules/locale-data/pl";
import "@formatjs/intl-pluralrules/locale-data/pt";
import "@formatjs/intl-pluralrules/locale-data/ru";
import "@formatjs/intl-pluralrules/locale-data/tr";
import "@formatjs/intl-pluralrules/locale-data/zh";
