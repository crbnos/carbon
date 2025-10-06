import { requirePermissions } from "@carbon/auth/auth.server";
import { ProductLabelPDF } from "@carbon/documents/pdf";
import { labelSizes } from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
import { redirect, type LoaderFunctionArgs } from "@vercel/remix";

import type { TrackedEntityAttributes } from "@carbon/utils";
import { getCompanySettings } from "~/services/inventory.service";
import { getTrackedEntity } from "~/services/operations.service";
import { path } from "~/utils/path";

export const config = { runtime: "nodejs" };

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [companySettings, trackedEntity] = await Promise.all([
    getCompanySettings(client, companyId),
    getTrackedEntity(client, id),
  ]);

  // Get the label size from query params or default to avery5160
  const url = new URL(request.url);
  const labelParam = url.searchParams.get("labelSize");

  const labelSizeId =
    labelParam || companySettings.data?.productLabelSize || "avery5160";

  // Find the label size configuration
  let labelSize = labelSizes.find((size) => size.id === labelSizeId);

  if (!labelSize) {
    throw new Error("Invalid label size");
  }

  if (labelSize.zpl) {
    throw redirect(
      path.to.file.trackedEntityLabelZpl(id, {
        labelSize: labelSize.id,
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
      number:
        (trackedEntity.data?.attributes as TrackedEntityAttributes)?.[
          "Batch Number"
        ] ?? "",
      trackedEntityId: id,
      quantity: trackedEntity.data?.quantity ?? 1,
      trackingType: "Batch",
    },
  ];

  const stream = await renderToStream(
    <ProductLabelPDF items={items ?? []} labelSize={labelSize} />
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
  return new Response(body, { status: 200, headers });
}
