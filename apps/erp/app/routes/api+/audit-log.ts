import { requirePermissions } from "@carbon/auth/auth.server";
import {
  getEntityAuditLog,
  isAuditLogEnabled,
  syncAuditSubscriptions
} from "@carbon/database/audit";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const url = new URL(request.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  const recordId = url.searchParams.get("recordId");

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
    const entries = await getEntityAuditLog(
      client,
      companyId,
      entityType,
      entityId,
      { limit: 50, offset: 0, recordId: recordId ?? undefined }
    );
    return Response.json({ entries });
  } catch (err) {
    console.error("Failed to fetch audit log:", err);
    return Response.json({ entries: [] });
  }
}
