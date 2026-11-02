// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Sets or clears the installed app's icon badge. Only an installed app shows
// one; elsewhere the call is missing or does nothing. Chrome on macOS drops the
// badge when the app's window closes, and a push cannot bring it back until
// the app opens again.
export function setAppBadge(count: number) {
  if (typeof navigator === "undefined" || !("setAppBadge" in navigator)) {
    return;
  }
  const result =
    count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge();
  // Refused (Safari without notification permission): no badge is fine.
  result.catch(() => undefined);
}

// The companies whose notifications the badge counts: the ones the user works
// in. A customer or supplier membership has no ERP notifications, and the push
// side (the send-push "count-unread" step) counts the same set.
export function employeeCompanyIds(
  companies: { companyId: string | null; role: string | null }[]
): string[] {
  return companies.flatMap((company) =>
    company.role === "employee" && company.companyId ? [company.companyId] : []
  );
}
