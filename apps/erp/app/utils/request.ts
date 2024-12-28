import { parseAcceptLanguage } from "intl-parse-accept-language";

export const getLocale = (request: Request) => {
  const acceptLanguage = request.headers.get("accept-language");
  const locales = parseAcceptLanguage(acceptLanguage, {
    validate: Intl.DateTimeFormat.supportedLocalesOf,
  });
  return locales?.[0] ?? "en-US";
};
