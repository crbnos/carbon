import {
  formatDate,
  formatDateTime,
  formatRelativeTime,
  formatTimeAgo
} from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import { useCallback } from "react";

export function useDateFormatter() {
  const { locale } = useLocale();

  return {
    formatDate: useCallback(
      (dateString?: string | null, options?: Intl.DateTimeFormatOptions) =>
        formatDate(dateString, options, locale),
      [locale]
    ),
    formatDateTime: useCallback(
      (isoString: string) => formatDateTime(isoString, locale),
      [locale]
    ),
    formatRelativeTime: useCallback(
      (isoString: string) => formatRelativeTime(isoString, locale),
      [locale]
    ),
    formatTimeAgo: useCallback(
      (isoString: string) => formatTimeAgo(isoString, locale),
      [locale]
    )
  };
}
