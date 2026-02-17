import { requirePermissions } from "@carbon/auth/auth.server";
import { getEntityAuditLog, isAuditLogEnabled } from "@carbon/database/audit";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const url = new URL(request.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");

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
      { limit: 50, offset: 0 }
    );
    return Response.json({ entries });
  } catch (err) {
    console.error("Failed to fetch audit log:", err);
    return Response.json({ entries: [] });
  }
}
