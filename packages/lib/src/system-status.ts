// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import { z } from "zod";

const log = getLogger("lib", "system-status");

const FETCH_TIMEOUT_MS = 3000;

/**
 * The document `SYSTEM_STATUS_URL` must return. It comes from another host, so
 * every field is validated and `message` is only ever rendered as text.
 */
export const announcementValidator = z.object({
  // A new id shows the bar again to everyone who dismissed the previous one.
  id: z.string().min(1).max(100),
  message: z.string().min(1).max(500),
  severity: z.enum(["info", "warning", "critical"]).default("info"),
  href: z
    .url()
    .refine((value) => /^https?:\/\//i.test(value), "href must be http(s)")
    .optional(),
  linkLabel: z.string().min(1).max(60).optional(),
  dismissible: z.boolean().default(true)
});

export const systemStatusValidator = z.object({
  latestVersion: z.string().max(60).optional(),
  announcement: announcementValidator.nullish()
});

export type Announcement = z.infer<typeof announcementValidator>;
export type SystemStatus = z.infer<typeof systemStatusValidator>;

/** Fetches and validates the status document. Null on any failure. */
export async function fetchSystemStatus(
  url: string
): Promise<SystemStatus | null> {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!response.ok) {
      log.warn("System status request failed with {status}", {
        status: response.status
      });
      return null;
    }
    const parsed = systemStatusValidator.safeParse(await response.json());
    if (!parsed.success) {
      log.warn("System status document is not valid", {
        issues: parsed.error.issues
      });
      return null;
    }
    return parsed.data;
  } catch (error) {
    log.warn("System status request failed", { error });
    return null;
  }
}

const accountMoveValidator = z.object({ migrationDate: z.iso.date() });

/**
 * The day this company's account moves to another Carbon instance, read from
 * `company.dimensions.migrationDate` (`YYYY-MM-DD`). Null when it is absent or
 * not a date, so a typo set by hand shows nothing rather than "Invalid Date".
 */
export function accountMoveDate(dimensions: unknown): string | null {
  const parsed = accountMoveValidator.safeParse(dimensions);
  return parsed.success ? parsed.data.migrationDate : null;
}
