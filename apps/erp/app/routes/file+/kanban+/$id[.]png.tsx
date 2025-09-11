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

  const { id } = params;
  if (!id) throw new Error("Could not find kanban id");

  const kanban = await getKanban(client, id);

  if (kanban.error) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const kanbanUrl = `${baseUrl}${path.to.api.kanban(id)}`;

  const buffer = await generateQRCodeBuffer(kanbanUrl, 36);

  return new Response(buffer, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
