// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Messages, setupI18n } from "@lingui/core";
import { I18nProvider as LinguiProvider } from "@lingui/react";
import { type ReactNode, useMemo } from "react";
import { resolveLanguage } from "./config";

type LocaleProviderProps = {
  locale?: string | null;
  catalog?: Messages;
  children: ReactNode;
};

export function LocaleProvider({
  locale,
  catalog,
  children
}: LocaleProviderProps) {
  const language = resolveLanguage(locale);

  const i18n = useMemo(() => {
    const runtime = setupI18n();
    runtime.load(language, catalog ?? {});
    runtime.activate(language);
    return runtime;
  }, [catalog, language]);

  return <LinguiProvider i18n={i18n}>{children}</LinguiProvider>;
}
