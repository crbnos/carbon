// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { Json } from "@carbon/database";
import { storage } from "@carbon/files";
import { validator } from "@carbon/form";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData, useParams } from "react-router";
import { DateTime } from "~/components";
import RecordDocuments from "~/components/RecordDocuments";
import { useCurrencyFormatter, usePermissions, useRouteData } from "~/hooks";
import {
  serviceOrderPropertyFields,
  serviceOrderTextFields
} from "~/modules/service/service.models";
import type { ServiceOrder } from "~/modules/service/types";
import { ServiceOrderProperties } from "~/modules/service/ui/ServiceOrders";
import { ServiceRichText } from "~/modules/service/ui/ServiceRichText";
import { WarrantyBadge } from "~/modules/service/ui/ServiceStatus";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "service"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const files = await storage(client)
    .company(companyId)
    .list(`${companyId}/service/${id}`);

  return {
    // A visit's photos sit in a folder per visit, and a folder has no id.
    files: (files.data ?? []).filter((file) => file.id !== null)
  };
}

function failure(message: string) {
  return data({ success: false, error: { message } }, { status: 400 });
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const formData = await args.request.formData();
  const intent = formData.get("intent");
  const field = formData.get("field");
  const value = formData.get("value");

  let update: {
    field:
      | (typeof serviceOrderPropertyFields)[number]
      | (typeof serviceOrderTextFields)[number];
    value: unknown;
  };
  if (intent === "field") {
    if (!(serviceOrderTextFields as readonly unknown[]).includes(field)) {
      return failure("Unknown field");
    }
    try {
      update = {
        field: field as (typeof serviceOrderTextFields)[number],
        value: JSON.parse(typeof value === "string" ? value : "{}") as Json
      };
    } catch {
      return failure("Invalid text");
    }
  } else if (intent === "update") {
    if (!(serviceOrderPropertyFields as readonly unknown[]).includes(field)) {
      return failure("Unknown field");
    }
    update = {
      field: field as (typeof serviceOrderPropertyFields)[number],
      value: typeof value === "string" ? value : ""
    };
  } else {
    return failure("Unknown intent");
  }

  const api = await carbon(args.request);
  const result = await api.service.updateServiceOrderField({
    id: input.params.id,
    ...update
  });
  if (result.error) return failure(result.error.message);
  return { success: true };
}

export default function ServiceOrderDetailsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const { files } = useLoaderData<typeof loader>();
  const routeData = useRouteData<{ serviceOrder: ServiceOrder }>(
    path.to.serviceOrder(id)
  );
  const permissions = usePermissions();
  const formatter = useCurrencyFormatter();
  const order = routeData?.serviceOrder;
  if (!order) return null;

  const isFinal = order.status === "Closed" || order.status === "Cancelled";
  const isDisabled = !permissions.can("update", "service") || isFinal;
  const action = path.to.serviceOrderDetails(id);

  return (
    // As an element's page: a readable main column, and the order's
    // properties in a column beside it, each saved as it changes.
    <div className="@container flex h-full min-h-0 w-full">
      <div className="flex min-w-0 flex-1 flex-col @min-[56rem]:flex-row">
        <main className="min-w-0 flex-1 @min-[56rem]:overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[800px] flex-col gap-8 px-8 py-8">
            <OverviewSection title={<Trans>Subject</Trans>}>
              <div className="rounded-lg border border-border px-4 py-3">
                <dl className="grid grid-cols-1 gap-4 text-sm @md:grid-cols-2 @3xl:grid-cols-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <dt className="text-xs text-muted-foreground">
                      <Trans>Item</Trans>
                    </dt>
                    <dd className="truncate">
                      {[order.item?.readableIdWithRevision, order.item?.name]
                        .filter(Boolean)
                        .join(" · ")}
                    </dd>
                  </div>
                  {order.type === "Refurbishment" ? (
                    order.status === "Completed" ||
                    order.status === "Closed" ? (
                      <>
                        <div className="flex flex-col gap-1 min-w-0">
                          <dt className="text-xs text-muted-foreground">
                            <Trans>Capitalized</Trans>
                          </dt>
                          <dd className="tabular-nums">
                            {formatter.format(order.capitalizedAmount ?? 0)}
                          </dd>
                        </div>
                        <div className="flex flex-col gap-1 min-w-0">
                          <dt className="text-xs text-muted-foreground">
                            <Trans>Write-Down</Trans>
                          </dt>
                          <dd className="tabular-nums">
                            {formatter.format(order.writeDownAmount ?? 0)}
                          </dd>
                        </div>
                        <div className="flex flex-col gap-1 min-w-0">
                          <dt className="text-xs text-muted-foreground">
                            <Trans>Costing Method</Trans>
                          </dt>
                          <dd>{order.completionCostingMethod ?? "—"}</dd>
                        </div>
                      </>
                    ) : null
                  ) : (
                    <>
                      <div className="flex flex-col gap-1 min-w-0">
                        <dt className="text-xs text-muted-foreground">
                          <Trans>Warranty</Trans>
                        </dt>
                        <dd className="flex flex-wrap items-center gap-2">
                          {order.customerAsset && (
                            <WarrantyBadge asset={order.customerAsset} />
                          )}
                        </dd>
                      </div>
                      <div className="flex flex-col gap-1 min-w-0">
                        <dt className="text-xs text-muted-foreground">
                          <Trans>Labor Warranty Ends</Trans>
                        </dt>
                        <dd>
                          <DateTime
                            value={order.customerAsset?.laborWarrantyEndDate}
                            variant="date"
                            fallback="—"
                          />
                        </dd>
                      </div>
                      <div className="flex flex-col gap-1 min-w-0">
                        <dt className="text-xs text-muted-foreground">
                          <Trans>Parts Warranty Ends</Trans>
                        </dt>
                        <dd>
                          <DateTime
                            value={order.customerAsset?.partsWarrantyEndDate}
                            variant="date"
                            fallback="—"
                          />
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
              </div>
            </OverviewSection>

            <OverviewSection title={<Trans>Problem</Trans>}>
              <div className="rounded-lg border border-border px-4 py-3">
                <ServiceRichText
                  key={`${id}:problem`}
                  action={action}
                  field="problem"
                  value={order.problem}
                  isDisabled={isDisabled}
                  empty={<Trans>No problem described</Trans>}
                />
              </div>
            </OverviewSection>

            <OverviewSection title={<Trans>Resolution</Trans>}>
              <div className="rounded-lg border border-border px-4 py-3">
                <ServiceRichText
                  key={`${id}:resolution`}
                  action={action}
                  field="resolution"
                  value={order.resolution}
                  isDisabled={isDisabled}
                  empty={<Trans>No resolution yet</Trans>}
                />
              </div>
            </OverviewSection>

            <RecordDocuments
              files={files}
              id={id}
              bucketPrefix="service"
              module="service"
              isReadOnly={isDisabled}
              variant="section"
            />
          </div>
        </main>
        <aside className="shrink-0 border-t border-border px-5 py-6 @min-[56rem]:w-[300px] @min-[56rem]:overflow-y-auto @min-[56rem]:border-t-0 @min-[56rem]:border-l">
          <ServiceOrderProperties />
        </aside>
      </div>
    </div>
  );
}

/** As the project Overview: a small heading over its content, no card bar. */
function OverviewSection({
  title,
  children
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}
