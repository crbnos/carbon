import { requirePermissions } from "@carbon/auth/auth.server";
import { KanbanLabelPDF } from "@carbon/documents/pdf";
import { renderToStream } from "@react-pdf/renderer";
import { type LoaderFunctionArgs } from "@vercel/remix";
import { getBase64ImageFromSupabase } from "~/modules/shared";

export const config = { runtime: "nodejs" };

export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "inventory",
  });

  // Get kanban IDs from search params
  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids");

  if (!idsParam) {
    return new Response("No kanban IDs provided", { status: 400 });
  }

  // Parse comma-separated IDs
  const kanbanIds = idsParam.split(",").map((id) => id.trim());

  if (kanbanIds.length === 0) {
    return new Response("No valid kanban IDs provided", { status: 400 });
  }

  // Fetch all kanban records in parallel
  const kanbanPromises = kanbanIds.map((id) =>
    client.from("kanbans").select("*").eq("id", id).single()
  );
  const kanbanResults = await Promise.all(kanbanPromises);

  // Collect all thumbnails paths first
  const thumbnailPaths: Record<string, string> = {};
  const validKanbans: typeof kanbanResults = [];

  for (const result of kanbanResults) {
    if (!result.error && result.data) {
      validKanbans.push(result);
      if (result.data.thumbnailPath && result.data.id) {
        thumbnailPaths[result.data.id] = result.data.thumbnailPath;
      }
    }
  }

  // Fetch all thumbnails in parallel
  const thumbnails: Record<string, string | null> = {};
  if (Object.keys(thumbnailPaths).length > 0) {
    const thumbnailPromises = Object.entries(thumbnailPaths).map(
      async ([id, path]) => {
        const base64 = await getBase64ImageFromSupabase(client, path);
        return { id, data: base64 };
      }
    );

    const thumbnailResults = await Promise.all(thumbnailPromises);
    for (const thumbnail of thumbnailResults) {
      if (thumbnail.data) {
        thumbnails[thumbnail.id] = thumbnail.data;
      }
    }
  }

  // Transform to label format
  const labels = [];

  for (const result of validKanbans) {
    if (!result.error && result.data) {
      const kanban = result.data;

      // Prepare label data
      const labelData = {
        id: kanban.id!,
        itemId: kanban.itemId!,
        itemName: kanban.name || "",
        itemReadableId: kanban.readableIdWithRevision || kanban.itemId!,
        locationName: kanban.locationName || "",
        shelfId: kanban.shelfId,
        shelfName: kanban.shelfName,
        supplierName: kanban.supplierName,
        quantity: kanban.quantity ?? 0,
        unitOfMeasureCode: kanban.purchaseUnitOfMeasureCode,
        thumbnail: thumbnails[kanban.id!] || null,
      };

      labels.push(labelData);
    }
  }

  if (labels.length === 0) {
    return new Response("No valid kanbans found", { status: 404 });
  }

  // Generate PDF
  const stream = await renderToStream(<KanbanLabelPDF labels={labels} />);

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

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="Kanban Labels.pdf"`,
  });

  return new Response(body, { status: 200, headers });
}
