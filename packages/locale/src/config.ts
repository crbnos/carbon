import { getBrowserEnv } from "@carbon/env";

export const supportedLanguages = [
  "en",
  "fr",
  "de",
  "es",
  "it",
  "ja",
  "pl",
  "pt",
  "ru",
  "zh",
  "hi",
  "tr"
] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

const envDefaultLanguage = getBrowserEnv().DEFAULT_LANGUAGE;

export const defaultLanguage: SupportedLanguage = supportedLanguages.includes(
  envDefaultLanguage as SupportedLanguage
)
  ? (envDefaultLanguage as SupportedLanguage)
  : "en";

export const localeCookieName = "locale";

export const resolveLanguage = (
  locale: string | null | undefined
): SupportedLanguage => {
  if (!locale) return defaultLanguage;
  const normalized = locale.toLowerCase().split("-")[0];
  if (supportedLanguages.includes(normalized as SupportedLanguage)) {
    return normalized as SupportedLanguage;
  }
  return defaultLanguage;
};

/** Each language name written in that language (for pickers). */
export const languageNativeLabels: Record<SupportedLanguage, string> = {
  en: "English",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  it: "Italiano",
  ja: "日本語",
  pl: "Polski",
  pt: "Português",
  ru: "Русский",
  zh: "中文",
  hi: "हिन्दी",
  tr: "Türkçe"
};

/**
 * Options for language `<Select>` UIs: native endonyms, sorted for the active UI locale.
 */
export function getSortedLanguageSelectOptions(
  locale: string | null | undefined
): { label: string; value: SupportedLanguage }[] {
  const resolved = resolveLanguage(locale);
  return supportedLanguages
    .map((value) => ({
      value,
      label: languageNativeLabels[value]
    }))
    .sort((a, b) => a.label.localeCompare(b.label, resolved));
}
