// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DEFAULT_REDACT_FIELDS } from "@logtape/redaction";

export const REDACTED = "[REDACTED]";

/**
 * Field-name patterns whose values are masked in logs. LogTape's defaults minus
 * /email/i, /phone/i and /address/i: in an ERP those are ordinary business data
 * (contact.workPhone, address.addressLine1, customer emails), and hiding them
 * turns the log into a lie about what a request contained — a redacted `phone`
 * field once made a PGRST204 failure look impossible because the logged
 * arguments no longer showed the key that caused it.
 */
export const REDACT_FIELD_PATTERNS = DEFAULT_REDACT_FIELDS.filter(
  (pattern) =>
    !(
      pattern instanceof RegExp &&
      ["email", "phone", "address"].includes(pattern.source)
    )
);

/**
 * Replace a matched field's value with a visible marker. LogTape's default
 * action DELETES the field, and a deleted key is indistinguishable from one the
 * caller never sent.
 */
export function maskRedactedField(): unknown {
  return REDACTED;
}

/** Does a field name match any redaction pattern? Shared by the HTTP capture. */
export function isSensitiveKey(key: string): boolean {
  return REDACT_FIELD_PATTERNS.some((pattern) =>
    typeof pattern === "string"
      ? key.toLowerCase().includes(pattern.toLowerCase())
      : pattern.test(key)
  );
}

/**
 * Mask sensitive query-param values (`?code=…`, `?token=…`, …) while keeping the
 * rest of the query string readable. Returns "" for a bodyless query.
 */
export function redactSearch(search: string): string {
  if (!search || search === "?") return "";
  const params = new URLSearchParams(search);
  let changed = false;
  for (const key of params.keys()) {
    if (isSensitiveKey(key)) {
      params.set(key, REDACTED);
      changed = true;
    }
  }
  return changed ? `?${params.toString()}` : search;
}
