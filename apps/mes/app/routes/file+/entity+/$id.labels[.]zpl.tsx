import { requirePermissions } from "@carbon/auth/auth.server";
import { generateProductLabelZPL } from "@carbon/documents/zpl";
import { labelSizes } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getCompany,
  getCompanySettings,
  getDocumentTemplateConfig
} from "~/services/inventory.service";
import { resolveLabelLogo } from "~/services/labelLogo.server";
import { getTrackedEntity } from "~/services/operations.service";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [companySettings, trackedEntity] = await Promise.all([
    getCompanySettings(client, companyId),
    getTrackedEntity(client, id)
  ]);

  // Get the label size from query params or default to label2x1
  const url = new URL(request.url);
  const labelParam = url.searchParams.get("labelSize");

  const labelSizeId =
    labelParam || companySettings.data?.productLabelSize || "label2x1";

  // Find the label size configuration
  let labelSize = labelSizes.find((size) => size.id === labelSizeId);

  if (!labelSize) {
    throw new Error("Invalid label size");
  }

  if (!labelSize.zpl) {
    throw redirect(
      path.to.file.trackedEntityLabelPdf(id, {
        labelSize: labelSize.id
      })
    );
  }

  const item = await client
    .from("item")
    .select("readableId, revision")
    .eq("id", trackedEntity.data?.sourceDocumentId ?? "")
    .single();
  if (!item.data) {
    return new Response("Item not found", { status: 404 });
  }

  const items = [
    {
      itemId: item.data.readableId,
      revision: item.data.revision ?? "0",
      number: trackedEntity.data?.readableId ?? "",
      trackedEntityId: id,
      quantity: trackedEntity.data?.quantity ?? 1,
      trackingType: "Batch"
    }
  ];

  const template = await getDocumentTemplateConfig(
    client,
    companyId,
    "trackingLabel"
  );

  const company = await getCompany(client, companyId);
  const logo = await resolveLabelLogo(company.data, template, labelSize);

  // Generate ZPL for each item
  const zplCommands = items.map((item) =>
    generateProductLabelZPL(item, labelSize, template, logo)
  );
  const zplOutput = zplCommands.join("\n");

  const headers = new Headers({
    "Content-Type": "application/zpl",
    "Content-Disposition": `attachment; filename="labels-${id}.zpl"`
  });

  return new Response(zplOutput, { status: 200, headers });
}
