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

  // Get the label size from query params or default to avery5163
  const url = new URL(request.url);
  const labelParam = url.searchParams.get("labelSize");

  const labelSizeId =
    labelParam || companySettings.data?.productLabelSize || "avery5163";

  // Find the label size configuration
  let labelSize = labelSizes.find((size) => size.id === labelSizeId);

  if (!labelSize) {
    throw new Error("Invalid label size");
  }

  if (labelSize.zpl) {
    throw redirect(
      path.to.file.trackedEntityLabelZpl(id, {
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
