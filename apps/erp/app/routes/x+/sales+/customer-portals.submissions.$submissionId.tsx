// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation
} from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Review portal PO`,
  to: path.to.customerPortalSubmissions
};

type SubmittedLine = {
  partNumber: string;
  description?: string;
  quantity: number;
  unitPrice?: number;
  unitOfMeasureCode?: string;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
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
  if (!params.submissionId) throw notFound("Submission not found");
  const result = await client
    .from("customerPortalSubmission")
    .select(
      "id,companyId,customerId,portalId,poNumber,quoteId,salesOrderId,requestedDelivery,createdAt,status,lines,documentPaths"
    )
    .eq("id", params.submissionId)
    .eq("companyId", companyId)
    .eq("submissionType", "PO")
    .single();
  if (!result.data || result.error) throw notFound("Submission not found");
  const submission = result.data;
  const [customer, quote, quoteLines, quotePrices] = await Promise.all([
    client
      .from("customer")
      .select("name")
      .eq("id", submission.customerId)
      .eq("companyId", companyId)
      .single(),
    submission.quoteId
      ? client
          .from("quote")
          .select("quoteId,status,customerId")
          .eq("id", submission.quoteId)
          .eq("companyId", companyId)
          .single()
      : Promise.resolve({ data: null, error: null }),
    submission.quoteId
      ? client
          .from("quoteLine")
          .select("id,description,status,itemId")
          .eq("quoteId", submission.quoteId)
          .eq("companyId", companyId)
          .order("sortOrder")
      : Promise.resolve({ data: [], error: null }),
    submission.quoteId
      ? client
          .from("quoteLinePrice")
          .select("quoteLineId,quantity")
          .eq("quoteId", submission.quoteId)
          .eq("companyId", companyId)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (customer.error || quote.error || quoteLines.error || quotePrices.error)
    throw notFound("Unable to load purchase order details");
  const linePrices = new Map<string, number[]>();
  for (const price of quotePrices.data ?? []) {
    const quantities = linePrices.get(price.quoteLineId) ?? [];
    quantities.push(price.quantity);
    linePrices.set(price.quoteLineId, quantities);
  }
  const lines = Array.isArray(submission.lines)
    ? submission.lines.filter(
        (line): line is SubmittedLine =>
          typeof line === "object" &&
          line !== null &&
          !Array.isArray(line) &&
          typeof line.partNumber === "string" &&
          typeof line.quantity === "number"
      )
    : [];
  const documents = Array.isArray(submission.documentPaths)
    ? submission.documentPaths.filter(
        (documentPath): documentPath is string =>
          typeof documentPath === "string" &&
          documentPath.startsWith(
            `${companyId}/customer-portal/${submission.portalId}/`
          ) &&
          documentPath.toLowerCase().endsWith(".pdf")
      )
    : [];
  return {
    submission,
    customerName: customer.data?.name ?? submission.customerId,
    quote: quote.data,
    quoteLines: (quoteLines.data ?? []).map((line) => ({
      ...line,
      quantities: [...new Set(linePrices.get(line.id) ?? [])].sort(
        (a, b) => a - b
      )
    })),
    lines,
    documents
  };
}

export async function action(args: ActionFunctionArgs) {
  assertIsPost(args.request);
  const { client, companyId } = await requirePermissions(args.request, {
    update: "sales",
    role: "employee"
  });
  await requireFeature({
    request: args.request,
    client,
    companyId,
    feature: "CUSTOMER_PORTALS",
    redirectTo: path.to.customerPortals
  });
  const submissionId = args.params.submissionId;
  if (!submissionId) throw notFound("Submission not found");
  const form = await args.request.formData();
  const api = await carbon(args.request);
  if (form.get("intent") === "reject") {
    const result = await api.sales.rejectCustomerPortalPoSubmission({
      submissionId
    });
    if (result.error)
      return data({ message: result.error.message }, { status: 400 });
    return redirect(path.to.customerPortalSubmissions);
  }
  if (form.get("intent") !== "accept")
    return data({ message: "Unknown action" }, { status: 400 });
  const selectedLines: Record<string, { quantity: number }> = {};
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("quantity:") || typeof value !== "string") continue;
    const quantity = Number(value);
    if (Number.isFinite(quantity) && quantity > 0) {
      selectedLines[key.slice("quantity:".length)] = { quantity };
    }
  }
  const result = await api.sales.acceptCustomerPortalPoSubmission({
    submissionId,
    selectedLines,
    acknowledged: form.get("acknowledged") === "on"
  });
  if (result.error)
    return data({ message: result.error.message }, { status: 400 });
  if (result.data && "violations" in result.data) {
    return data(
      {
        message: result.data.violations
          .map((violation) => violation.message)
          .join("; ")
      },
      { status: 400 }
    );
  }
  if (result.data?.salesOrderId)
    return redirect(path.to.salesOrder(result.data.salesOrderId));
  return data(
    { message: "The purchase order could not be accepted" },
    { status: 400 }
  );
}

export default function PortalPurchaseOrderReview() {
  const { submission, customerName, quote, quoteLines, lines, documents } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  return (
    <div className="h-full overflow-auto p-6">
      <Link
        className="text-sm text-primary underline"
        to={path.to.customerPortalSubmissions}
      >
        ← Pending portal POs
      </Link>
      <div className="mt-5 mb-6">
        <h1 className="text-2xl font-semibold">
          PO {submission.poNumber ?? submission.id}
        </h1>
        <p className="text-muted-foreground">
          {customerName} · {submission.status} · Submitted{" "}
          {new Date(submission.createdAt).toLocaleString()}
        </p>
      </div>
      {actionData?.message && (
        <p
          role="alert"
          className="mb-5 rounded border border-destructive p-3 text-destructive"
        >
          {actionData.message}
        </p>
      )}
      <dl className="mb-6 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted-foreground">Requested delivery</dt>
          <dd>{submission.requestedDelivery ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Quote</dt>
          <dd>
            {submission.quoteId ? (
              <Link
                className="text-primary underline"
                to={path.to.quote(submission.quoteId)}
              >
                {quote?.quoteId ?? submission.quoteId} (
                {quote?.status ?? "unknown"})
              </Link>
            ) : (
              "None"
            )}
          </dd>
        </div>
        {submission.salesOrderId && (
          <div>
            <dt className="text-sm text-muted-foreground">Order</dt>
            <dd>
              <Link
                className="text-primary underline"
                to={path.to.salesOrder(submission.salesOrderId)}
              >
                Open order
              </Link>
            </dd>
          </div>
        )}
      </dl>
      <section className="mb-6">
        <h2 className="mb-2 text-lg font-medium">Submitted lines</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="p-3">Part number</th>
                <th className="p-3">Description</th>
                <th className="p-3">Quantity</th>
                <th className="p-3">Unit price</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr
                  key={`${line.partNumber}-${index}`}
                  className="border-b last:border-0"
                >
                  <td className="p-3">{line.partNumber}</td>
                  <td className="p-3">{line.description ?? "—"}</td>
                  <td className="p-3">
                    {line.quantity} {line.unitOfMeasureCode ?? ""}
                  </td>
                  <td className="p-3">{line.unitPrice ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!submission.quoteId && (
          <p className="mt-2 text-sm text-muted-foreground">
            Acceptance creates a Draft order. Map and price these lines on that
            order before confirming it.
          </p>
        )}
      </section>
      <section className="mb-6">
        <h2 className="mb-2 text-lg font-medium">Purchase order PDF</h2>
        {documents.map((documentPath) => (
          <p key={documentPath}>
            <a
              className="text-primary underline"
              href={path.to.file.previewFile(`private/${documentPath}`)}
              target="_blank"
              rel="noreferrer"
            >
              Download submitted PO
            </a>
          </p>
        ))}
      </section>
      {submission.status === "Pending" && (
        <div className="space-y-4 border-t pt-5">
          <Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="accept" />
            {submission.quoteId && (
              <section>
                <h2 className="mb-2 text-lg font-medium">
                  Choose quoted quantities
                </h2>
                <p className="mb-3 text-sm text-muted-foreground">
                  Select at least one quantity break. Unselected lines stay off
                  the order.
                </p>
                {quoteLines
                  .filter((line) => line.status !== "No Quote")
                  .map((line) => (
                    <label
                      key={line.id}
                      className="mb-2 flex items-center justify-between gap-4 rounded border p-3"
                    >
                      <span>{line.description || line.itemId || line.id}</span>
                      <select
                        name={`quantity:${line.id}`}
                        className="rounded border bg-background p-2"
                        defaultValue="0"
                      >
                        <option value="0">Do not include</option>
                        {line.quantities.map((quantity) => (
                          <option key={quantity} value={quantity}>
                            {quantity}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input type="checkbox" name="acknowledged" /> Acknowledge
                  sales rule warnings
                </label>
              </section>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded bg-primary px-4 py-2 text-primary-foreground"
            >
              {isSubmitting && navigation.formData?.get("intent") === "accept"
                ? "Accepting…"
                : "Accept PO"}
            </button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="reject" />
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded border px-4 py-2"
            >
              {isSubmitting && navigation.formData?.get("intent") === "reject"
                ? "Rejecting…"
                : "Reject PO"}
            </button>
          </Form>
        </div>
      )}
    </div>
  );
}
