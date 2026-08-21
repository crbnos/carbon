import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getPunchoutSession } from "~/modules/purchasing";

// Fallback poll for the waiting UI when the return window's postMessage is missed.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const sessionId = params.sessionId;
  if (!sessionId) return { status: null, purchaseOrderId: null };

  const session = await getPunchoutSession(client, sessionId, companyId);
  return {
    status: session.data?.status ?? null,
    purchaseOrderId: session.data?.purchaseOrderId ?? null
  };
}
