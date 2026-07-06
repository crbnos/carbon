import { requirePermissions } from "@carbon/auth/auth.server";
import { StorageUnitLabelPDF } from "@carbon/documents/pdf";
import { labelSizes } from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "inventory"
  });

  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids");

  if (!idsParam) {
    return new Response("No storage unit IDs provided", { status: 400 });
  }

  const ids = idsParam
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    return new Response("No valid storage unit IDs provided", { status: 400 });
  }

  const labelSizeId = url.searchParams.get("labelSize") ?? "avery5163";
  const labelSize = labelSizes.find((s) => s.id === labelSizeId);

  if (!labelSize) {
    return new Response(`Invalid label size: ${labelSizeId}`, { status: 400 });
  }

  const { data: units, error } = await client
    .from("storageUnit")
    .select("id, name")
    .in("id", ids);

  if (error || !units?.length) {
    return new Response("No storage units found", { status: 404 });
  }

  const stream = await renderToStream(
    <StorageUnitLabelPDF items={units} labelSize={labelSize} />
  );

  const body: Buffer = await new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (data: Uint8Array) => {
      buffers.push(data);
    });
    stream.on("end", () => {
      resolve(Buffer.concat(buffers));
    });
    stream.on("error", reject);
  });

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="storage-unit-labels.pdf"`
    }
  });
}
