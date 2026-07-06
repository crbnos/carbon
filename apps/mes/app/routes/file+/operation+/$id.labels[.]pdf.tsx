import { requirePermissions } from "@carbon/auth/auth.server";
import { ProductLabelPDF } from "@carbon/documents/pdf";
import { labelSizes } from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getCompany,
  getCompanySettings,
  getDocumentTemplateConfig
} from "~/services/inventory.service";
import { resolveLabelLogo } from "~/services/labelLogo.server";
import { getTrackedEntitiesByOperationId } from "~/services/operations.service";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [companySettings, trackedEntities] = await Promise.all([
    getCompanySettings(client, companyId),
    getTrackedEntitiesByOperationId(client, id)
  ]);

  // Get the label size from query params or default to avery5163
  const url = new URL(request.url);
  const labelParam = url.searchParams.get("labelSize");
  const trackedEntityIdParam = url.searchParams.get("trackedEntityId");
  const labelSizeId =
    labelParam || companySettings.data?.productLabelSize || "avery5163";

  // Find the label size configuration
  let labelSize = labelSizes.find((size) => size.id === labelSizeId);

  if (!labelSize) {
    throw new Error("Invalid label size");
  }

  if (labelSize.zpl) {
    throw redirect(
      path.to.file.operationLabelsZpl(id, {
        labelSize: labelSize.id,
        trackedEntityId: trackedEntityIdParam ?? undefined
      })
    );
  }

  let filteredTracking = trackedEntities.data;

  // Filter by lineId if provided
  if (trackedEntityIdParam) {
    filteredTracking =
      filteredTracking?.filter(
        (tracking) => tracking.id === trackedEntityIdParam
      ) ?? [];
  }

  const items = filteredTracking
    ?.map((tracking) => ({
      itemId: tracking.sourceDocumentReadableId ?? "",
      revision: "0",
      number: tracking.readableId ?? "",
      trackedEntityId: tracking.id,
      quantity: tracking.quantity,
      trackingType: tracking.quantity > 1 ? "Batch" : "Serial"
    }))
    .sort((a, b) => {
      if (a.itemId === b.itemId) {
        return a.number.localeCompare(b.number);
      }
      return a.itemId.localeCompare(b.itemId);
    });

  if (!Array.isArray(items) || items.length === 0) {
    return new Response(
      `No items found for operation ${id}${
        trackedEntityIdParam
          ? ` and tracked entity ${trackedEntityIdParam}`
          : ""
      }`,
      { status: 404 }
    );
  }

  const template = await getDocumentTemplateConfig(
    client,
    companyId,
    "trackingLabel"
  );

  const company = await getCompany(client, companyId);
  const logo = await resolveLabelLogo(company.data, template, labelSize);

  const stream = await renderToStream(
    <ProductLabelPDF
      items={items ?? []}
      labelSize={labelSize}
      template={template}
      company={company.data as any}
      logo={logo}
    />
  );

  const body: Buffer = await new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (data) => {
      buffers.push(data);
    });
    stream.on("end", () => {
      resolve(Buffer.concat(buffers));
    });
    stream.on("error", reject);
  });

  const headers = new Headers({ "Content-Type": "application/pdf" });
  return new Response(new Uint8Array(body), { status: 200, headers });
}
