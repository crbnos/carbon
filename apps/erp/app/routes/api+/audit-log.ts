// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import {
  getEntityAuditLog,
  isAuditLogEnabled,
  syncAuditSubscriptions
} from "@carbon/ee/audit.server";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";

const logger = getLogger("erp", "audit-log");

// `all=true` (the History drawer's Download) pages through every entry still in
// the live log, up to a hard cap.
const DOWNLOAD_PAGE_SIZE = 500;
const DOWNLOAD_MAX_ENTRIES = 10_000;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const url = new URL(request.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  const recordId = url.searchParams.get("recordId");
  const all = url.searchParams.get("all") === "true";

  if (!entityType || !entityId) {
    return Response.json(
      { error: "entityType and entityId are required" },
      { status: 400 }
    );
  }

  // Check if audit log is enabled for this company
  try {
    const enabled = await isAuditLogEnabled(client, companyId);
    if (!enabled) {
      return Response.json({ entries: [] });
    }

    // Keep subscriptions in sync so newly-audited tables (e.g. itemShelfLife)
    // are captured for companies that enabled audit logging before they existed.
    try {
      await syncAuditSubscriptions(client, companyId);
    } catch {
      // Non-critical: return whatever history already exists.
    }
  } catch {
    // Table might not exist yet
    return Response.json({ entries: [] });
  }

  // Get audit log entries for this entity
  try {
    if (!all) {
      const entries = await getEntityAuditLog(
        client,
        companyId,
        entityType,
        entityId,
        { limit: 50, offset: 0, recordId: recordId ?? undefined }
      );
      return Response.json({ entries });
    }

    // Reads past the cap by up to one page, so a history longer than the cap
    // is reported as truncated rather than passed off as complete.
    const entries: Awaited<ReturnType<typeof getEntityAuditLog>> = [];
    while (entries.length <= DOWNLOAD_MAX_ENTRIES) {
      const page = await getEntityAuditLog(
        client,
        companyId,
        entityType,
        entityId,
        {
          limit: DOWNLOAD_PAGE_SIZE,
          offset: entries.length,
          recordId: recordId ?? undefined
        }
      );
      entries.push(...page);
      if (page.length < DOWNLOAD_PAGE_SIZE) break;
    }
    return Response.json({
      entries: entries.slice(0, DOWNLOAD_MAX_ENTRIES),
      truncated: entries.length > DOWNLOAD_MAX_ENTRIES
    });
  } catch (err) {
    logger.error("Failed to fetch audit log", {
      companyId,
      entityType,
      entityId,
      all,
      error: err
    });
    // A download must fail visibly: an empty list would save a file with no
    // history in it.
    return all
      ? Response.json({ entries: [] }, { status: 500 })
      : Response.json({ entries: [] });
  }
}
