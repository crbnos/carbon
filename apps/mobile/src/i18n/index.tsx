// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  DEFAULT_LOCALE,
  MES_LOCALES,
  type MesLocale,
  resolveMesLocale
} from "@carbon/mes-core";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { getLocales } from "expo-localization";
import { type ReactNode, useEffect, useState } from "react";
import { catalogs } from "./generated";

/**
 * The app reuses the MES Lingui catalog, so a string translated for web MES is
 * already translated here. The catalogs are compiled ahead of time into
 * `./generated` by `pnpm run catalogs` (see scripts/build-catalogs.mjs) rather
 * than through `@lingui/metro-transformer`: the repo already compiles them as a
 * build step, and inlining the result means Metro needs no extra transformer
 * and `tsc` typechecks every catalog.
 */
export function loadLocale(locale: MesLocale): MesLocale {
  const messages = catalogs[locale] ?? catalogs[DEFAULT_LOCALE];
  const resolved = catalogs[locale] ? locale : DEFAULT_LOCALE;
  i18n.load(resolved, messages ?? {});
  i18n.activate(resolved);
  return resolved;
}

/** The device's language, when the MES catalog ships it. */
export function deviceLocale(): MesLocale {
  const tag = getLocales()[0]?.languageTag ?? null;
  return resolveMesLocale(tag);
}

export { MES_LOCALES, type MesLocale };

export function I18nRoot({
  locale,
  children
}: {
  locale?: MesLocale;
  children: ReactNode;
}) {
  // Activate synchronously on first render: a screen that renders before a
  // locale is active throws "Attempted to call a translation function without
  // setting a locale".
  const [active, setActive] = useState<MesLocale>(() =>
    loadLocale(locale ?? deviceLocale())
  );

  useEffect(() => {
    if (locale && locale !== active) setActive(loadLocale(locale));
  }, [locale, active]);

  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}
