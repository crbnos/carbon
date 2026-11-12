// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Portal purchase orders`,
  to: path.to.customerPortalSubmissions
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
    role: "employee"
  });
  await requireFeature({
    request,
    client,
    companyId,
    feature: "CUSTOMER_PORTALS",
    redirectTo: path.to.customerPortals
  });
  const submissions = await client
    .from("customerPortalSubmission")
    .select(
      "id,customerId,poNumber,quoteId,requestedDelivery,createdAt,status,lines"
    )
    .eq("companyId", companyId)
    .eq("submissionType", "PO")
    .eq("status", "Pending")
    .order("createdAt", { ascending: true })
    .limit(200);
  if (submissions.error)
    throw notFound("Unable to load portal purchase orders");
  const customerIds = [
    ...new Set((submissions.data ?? []).map((row) => row.customerId))
  ];
  const customers = customerIds.length
    ? await client
        .from("customer")
        .select("id,name")
        .eq("companyId", companyId)
        .in("id", customerIds)
    : { data: [], error: null };
  if (customers.error) throw notFound("Unable to load customers");
  const names = new Map(
    (customers.data ?? []).map((customer) => [customer.id, customer.name])
  );
  return {
    submissions: (submissions.data ?? []).map((row) => ({
      ...row,
      customerName: names.get(row.customerId) ?? row.customerId,
      lineCount: Array.isArray(row.lines) ? row.lines.length : 0
    }))
  };
}

export default function PortalPurchaseOrders() {
  const { submissions } = useLoaderData<typeof loader>();
  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Portal purchase orders</h1>
        <p className="text-muted-foreground">
          Review customer POs before creating an order.
        </p>
      </div>
      {submissions.length === 0 ? (
        <p className="rounded-lg border p-6 text-muted-foreground">
          No purchase orders are awaiting review.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="p-3 font-medium">Customer</th>
                <th className="p-3 font-medium">PO number</th>
                <th className="p-3 font-medium">Quote</th>
                <th className="p-3 font-medium">Lines</th>
                <th className="p-3 font-medium">Requested delivery</th>
                <th className="p-3 font-medium">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((submission) => (
                <tr key={submission.id} className="border-b last:border-0">
                  <td className="p-3">
                    <Link
                      className="font-medium text-primary underline"
                      to={path.to.customerPortalSubmission(submission.id)}
                    >
                      {submission.customerName}
                    </Link>
                  </td>
                  <td className="p-3">{submission.poNumber ?? "—"}</td>
                  <td className="p-3">
                    {submission.quoteId ? "Linked" : "None"}
                  </td>
                  <td className="p-3">{submission.lineCount}</td>
                  <td className="p-3">{submission.requestedDelivery ?? "—"}</td>
                  <td className="p-3">
                    {new Date(submission.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
