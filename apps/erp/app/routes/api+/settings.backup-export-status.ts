import { requirePermissions } from "@carbon/auth/auth.server";
import { isInternalEmail } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { getCompanyExportRun } from "~/modules/settings";

// Polled by the export progress modal (and the in-progress list row) for live
// phase/done/total. One marker per company: the export job writes it while
// running, clears it on success and flips it to "failed" on error — so a null
// `status` means the run hasn't written its first heartbeat yet OR has finished;
// the modal uses the backup list appearing to confirm completion.
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, email } = await requirePermissions(request, {
    update: "settings"
  });
  if (!isInternalEmail(email)) throw new Response("Not found", { status: 404 });

  const run = await getCompanyExportRun(client, companyId);
  return {
    status: run.data?.status ?? null,
    progress: run.data?.progress ?? null,
    startedAt: run.data?.startedAt ?? null,
    error: run.data?.error ?? null
  };
}
