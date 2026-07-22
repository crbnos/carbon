import { ASSEMBLER_SERVICE_API_KEY, ASSEMBLER_SERVICE_URL } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

// Cancels an in-flight (or stuck) eager optimise — backs the model tab's
// progress Cancel (parity with the ERP api+/model.optimize-cancel route).
// Stamps the row Failed so the viewer settles immediately, and best-effort
// cancels the assembler job so the waiting Inngest run fails non-retriably.
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const modelUploadId = formData.get("modelUploadId") as string | null;
  if (!modelUploadId) {
    return data({ success: false }, { status: 400 });
  }

  const cancelled = await client
    .from("modelUpload")
    .update({
      optimizeStatus: "Failed",
      optimizeError: "Cancelled by user"
    })
    .eq("id", modelUploadId)
    .eq("companyId", companyId)
    .in("optimizeStatus", ["Queued", "Processing"])
    .select("id");

  if (cancelled.error) {
    return data({ success: false }, { status: 500 });
  }

  if (ASSEMBLER_SERVICE_URL && cancelled.data.length > 0) {
    await fetch(
      `${ASSEMBLER_SERVICE_URL}/v1/jobs/optimize-${modelUploadId}/cancel`,
      {
        method: "POST",
        headers: ASSEMBLER_SERVICE_API_KEY
          ? { Authorization: `Bearer ${ASSEMBLER_SERVICE_API_KEY}` }
          : {},
        signal: AbortSignal.timeout(5000)
      }
    ).catch(() => {
      // Best-effort — the row is already stamped Failed. A missed cancel just
      // means the compute finishes anyway and flips the row to Success, which
      // is harmless (the artifact is real).
    });
  }

  return { success: true, cancelled: cancelled.data.length > 0 };
}
