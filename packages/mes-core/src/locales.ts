// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The locales the MES Lingui catalog ships, duplicated here on purpose.
 *
 * `@carbon/locale`'s own `config.ts` imports `getBrowserEnv` from `@carbon/env`,
 * which validates the FULL server env at module load (SUPABASE_SERVICE_ROLE_KEY,
 * SESSION_SECRET, REDIS_URL, ...). That throws in Hermes, where there is no
 * `document` and no server env — so the mobile app cannot import it. The list is
 * pinned against `lingui.config.js` by `locales.test.ts`, so the two cannot drift.
 */
export const MES_LOCALES = [
  "en",
  "es",
  "de",
  "it",
  "ja",
  "zh",
  "fr",
  "pl",
  "pt",
  "ru",
  "hi",
  "tr",
  "ko"
] as const;

export type MesLocale = (typeof MES_LOCALES)[number];

export const DEFAULT_LOCALE: MesLocale = "en";

export function isMesLocale(
  value: string | null | undefined
): value is MesLocale {
  return !!value && (MES_LOCALES as readonly string[]).includes(value);
}

/** The locale to activate for a device language tag ("es-MX" -> "es"), else `en`. */
export function resolveMesLocale(tag: string | null | undefined): MesLocale {
  if (!tag) return DEFAULT_LOCALE;
  const base = tag.split(/[-_]/)[0]?.toLowerCase();
  return isMesLocale(base) ? base : DEFAULT_LOCALE;
}
