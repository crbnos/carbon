import { requirePermissions } from "@carbon/auth/auth.server";
import { generateQRCodeBuffer } from "@carbon/documents/qr";
import { json, type LoaderFunctionArgs } from "@vercel/remix";
import { getKanban } from "~/modules/inventory/inventory.service";
import { path } from "~/utils/path";

export const config = { runtime: "nodejs" };

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "inventory",
  });

  const { id, action } = params;
  if (!id) throw new Error("Could not find kanban id");
  if (!action) throw new Error("Could not find kanban action");
  if (!["order", "start", "complete"].includes(action)) {
    throw new Error("Invalid kanban action");
  }

  const kanban = await getKanban(client, id);

  if (kanban.error) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  let kanbanUrl = "";
  let qrColor = "000000";
  const baseUrl = `${url.protocol}//${url.host}`;
  if (action === "order") {
    kanbanUrl = `${baseUrl}${path.to.api.kanban(id)}`;
    qrColor = "000000"; // black
  } else if (action === "start") {
    kanbanUrl = `${baseUrl}${path.to.api.kanbanStart(id)}`;
    qrColor = "059669"; // emerald-600
  } else if (action === "complete") {
    kanbanUrl = `${baseUrl}${path.to.api.kanbanComplete(id)}`;
    qrColor = "2563eb"; // blue-600
  }

  console.log({ qrColor });

  const buffer = await generateQRCodeBuffer(kanbanUrl, 36, qrColor);

  // @ts-ignore
  return new Response(buffer, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
