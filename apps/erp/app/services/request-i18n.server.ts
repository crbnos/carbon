import { resolveLanguage, type SupportedLanguage } from "@carbon/locale";
import { getPreferenceHeaders } from "@carbon/remix";
import { type I18n, setupI18n } from "@lingui/core";
import { loadLinguiCatalogForRequest } from "./lingui.server";

export async function getRequestI18n(request: Request): Promise<I18n> {
  const preferences = getPreferenceHeaders(request);
  const language: SupportedLanguage = resolveLanguage(preferences.locale);
  const catalog = await loadLinguiCatalogForRequest(request, language);

  const i18n = setupI18n();
  i18n.loadAndActivate({
    locale: language,
    messages: catalog
  });

  return i18n;
}
