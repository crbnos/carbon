// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { Json } from "@carbon/database";
import { storage } from "@carbon/files";
import { validator } from "@carbon/form";
import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData, useParams } from "react-router";
import { DateTime, Hyperlink } from "~/components";
import RecordDocuments from "~/components/RecordDocuments";
import { usePermissions, useRouteData } from "~/hooks";
import type { ServiceOrder } from "~/modules/service";
import {
  serviceOrderUpdateValidator,
  updateServiceOrder
} from "~/modules/service";
import { ServiceRichText } from "~/modules/service/ui/ServiceRichText";
import { WarrantyBadge } from "~/modules/service/ui/ServiceStatus";
import { path } from "~/utils/path";

/** The order fields the Properties panel saves one at a time. */
const PROPERTY_FIELDS = [
  "customerLocationId",
  "customerContactId",
  "customerContractId",
  "priority",
  "invoiceDetail"
] as const;

/** The rich-text fields the editors on this page save. */
const TEXT_FIELDS = ["problem", "resolution"] as const;

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

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "service"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const intent = formData.get("intent");
  const field = formData.get("field");
  const value = formData.get("value");

  let changes: Record<string, unknown>;
  if (intent === "field") {
    if (!(TEXT_FIELDS as readonly unknown[]).includes(field)) {
      return failure("Unknown field");
    }
    let document: Json;
    try {
      document = JSON.parse(typeof value === "string" ? value : "{}");
    } catch {
      return failure("Invalid text");
    }
    changes = { [field as string]: document };
  } else if (intent === "update") {
    if (!(PROPERTY_FIELDS as readonly unknown[]).includes(field)) {
      return failure("Unknown field");
    }
    const form = new FormData();
    form.set("id", id);
    form.set(field as string, typeof value === "string" ? value : "");
    const validation = await validator(serviceOrderUpdateValidator).validate(
      form
    );
    if (validation.error) return failure("Invalid value");
    // Only the one field: an absent key would be saved as null.
    changes = {
      [field as string]:
        validation.data[field as (typeof PROPERTY_FIELDS)[number]]
    };
  } else {
    return failure("Unknown intent");
  }

  const update = await updateServiceOrder(client, {
    id,
    ...changes,
    companyId,
    updatedBy: userId
  });
  if (update.error) return failure(update.error.message);

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
  const order = routeData?.serviceOrder;
  if (!order) return null;

  const isFinal = order.status === "Closed" || order.status === "Cancelled";
  const isDisabled = !permissions.can("update", "service") || isFinal;
  const action = path.to.serviceOrderDetails(id);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Subject</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 @container @md:grid-cols-2 text-sm">
            <div className="flex flex-col gap-1 min-w-0">
              <dt className="text-xs text-muted-foreground">
                <Trans>Serial</Trans>
              </dt>
              <dd className="whitespace-nowrap">
                {order.customerAssetId ? (
                  <Hyperlink to={path.to.customerAsset(order.customerAssetId)}>
                    {order.trackedEntity?.readableId}
                  </Hyperlink>
                ) : (
                  order.trackedEntity?.readableId
                )}
              </dd>
            </div>
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
            <div className="flex flex-col gap-1 min-w-0">
              <dt className="text-xs text-muted-foreground">
                <Trans>Site</Trans>
              </dt>
              <dd className="truncate">
                {order.customerLocation?.name ?? "—"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Problem</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ServiceRichText
            key={`${id}:problem`}
            action={action}
            field="problem"
            value={order.problem}
            isDisabled={isDisabled}
            empty={<Trans>No problem described</Trans>}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Resolution</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ServiceRichText
            key={`${id}:resolution`}
            action={action}
            field="resolution"
            value={order.resolution}
            isDisabled={isDisabled}
            empty={<Trans>No resolution yet</Trans>}
          />
        </CardContent>
      </Card>

      <RecordDocuments
        files={files}
        id={id}
        bucketPrefix="service"
        module="service"
        isReadOnly={isDisabled}
      />
    </>
  );
}
