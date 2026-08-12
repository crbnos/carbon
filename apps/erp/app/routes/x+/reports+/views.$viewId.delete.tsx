import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deleteReportView } from "~/modules/accounting";
import { path } from "~/utils/path";

// Delete a saved report view. Posted to by the ConfirmDelete modal on both the
// reports hub (/x/accounting/reports) and the analytics report control bar.
// On success we redirect back to the referrer with the `view` param stripped, so
// the analytics page drops the now-dead selection and the hub list refreshes.
// RLS keeps deletes owner-only.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { viewId } = params;
  if (!viewId) {
    throw new Error("viewId not found");
  }

  const deletion = await deleteReportView(client, viewId, companyId);
  if (deletion.error) {
    return data(
      {},
      await flash(request, error(deletion.error, "Failed to delete view"))
    );
  }

  const referer = request.headers.get("referer");
  let redirectTo: string = path.to.reports;
  if (referer) {
    const url = new URL(referer);
    url.searchParams.delete("view");
    redirectTo = `${url.pathname}${url.search}`;
  }

  throw redirect(redirectTo, await flash(request, success("View deleted")));
}
