import { resolveLanguage } from "@carbon/locale";
import { type Messages, setupI18n } from "@lingui/core";

const catalogLoaders = import.meta.glob(
  "../../../../packages/locale/locales/*/erp.mjs",
  {
    import: "messages"
  }
) as Record<string, () => Promise<Messages>>;

export async function loadLinguiCatalogForRequest(
  _request: Request,
  locale: string | null | undefined
) {
  const language = resolveLanguage(locale);
  const catalogPath = `../../../../packages/locale/locales/${language}/erp.mjs`;
  const load = catalogLoaders[catalogPath];
  return load ? load() : {};
}

/**
 * Resolve the job-traveler materials-section labels against the request locale.
 * Lives in a `.server` module (excluded from Lingui extraction) so the string-id
 * `i18n._(...)` lookups reuse the existing catalog entries instead of being
 * extracted as new, untranslated explicit-id messages.
 */
export async function getMaterialsTravelerLabels(
  request: Request,
  locale: string | null | undefined
) {
  const language = resolveLanguage(locale);
  const catalog = await loadLinguiCatalogForRequest(request, locale);
  const i18n = setupI18n();
  i18n.load(language, catalog);
  i18n.activate(language);
  return {
    heading: i18n._("Materials"),
    material: i18n._("Material"),
    description: i18n._("Description"),
    quantity: i18n._("Quantity")
  };
}
