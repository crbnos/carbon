import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getBatchableOperations } from "~/modules/production";
import type { BatchCandidate } from "~/modules/production/types";

// Candidate operations for the batch builder (the batches-page wizard). Wraps the
// get_batchable_operations RPC — the same source the deleted schedule board used —
// and enriches each row with the op's setup time/unit + due date, which the RPC
// omits but the builder's setup-saving and due-spread chips need. Rows carrying a
// jobOperationBatchId (Active/Completing lane members) are kept; the builder
// partitions client-side (add-mode shows the target batch's members).
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const url = new URL(request.url);
  const locationId = url.searchParams.get("location");
  const processId = url.searchParams.get("process");
  if (!locationId || !processId) {
    return Response.json(
      { candidates: [] as BatchCandidate[] },
      { status: 400 }
    );
  }

  const operations = await getBatchableOperations(client, {
    locationId,
    processId
  });
  const rows = (operations.data ?? []) as unknown as BatchCandidate[];
  if (operations.error || rows.length === 0) {
    return { candidates: rows };
  }

  // Enrich with the fields the RPC doesn't return but the chips need.
  const opDetails = await client
    .from("jobOperation")
    .select("id, setupTime, setupUnit, dueDate")
    .in(
      "id",
      rows.map((r) => r.id)
    )
    .eq("companyId", companyId);
  const detailById = new Map(
    (opDetails.data ?? []).map((d) => [d.id, d] as const)
  );

  const candidates: BatchCandidate[] = rows.map((r) => {
    const d = detailById.get(r.id);
    return {
      ...r,
      setupTime: d?.setupTime ?? null,
      setupUnit: d?.setupUnit ?? null,
      dueDate: d?.dueDate ?? null
    };
  });

  return { candidates };
}
