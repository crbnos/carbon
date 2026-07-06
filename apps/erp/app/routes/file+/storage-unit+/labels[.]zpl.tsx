import { requirePermissions } from "@carbon/auth/auth.server";
import { generateStorageUnitLabelZPL } from "@carbon/documents/zpl";
import { labelSizes } from "@carbon/utils";
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

  const labelSizeId = url.searchParams.get("labelSize") ?? "label2x1";
  const labelSize = labelSizes.find((s) => s.id === labelSizeId);

  if (!labelSize?.zpl) {
    return new Response(`Label size ${labelSizeId} does not support ZPL`, {
      status: 400
    });
  }

  const { data: units, error } = await client
    .from("storageUnit")
    .select("id, name")
    .in("id", ids);

  if (error || !units?.length) {
    return new Response("No storage units found", { status: 404 });
  }

  const zplOutput = units
    .map((unit) => generateStorageUnitLabelZPL(unit, labelSize))
    .join("\n");

  return new Response(zplOutput, {
    status: 200,
    headers: {
      "Content-Type": "application/zpl",
      "Content-Disposition": `attachment; filename="storage-unit-labels.zpl"`
    }
  });
}
