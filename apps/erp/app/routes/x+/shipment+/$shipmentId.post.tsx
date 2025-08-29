import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { upsertDocument } from "~/modules/documents";
import { loader as pdfLoader } from "~/routes/file+/shipment+/$id[.]pdf";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory",
  });

  const { shipmentId } = params;
  if (!shipmentId) throw new Error("shipmentId not found");

  const setPendingState = await client
    .from("shipment")
    .update({
      status: "Pending",
    })
    .eq("id", shipmentId);

  if (setPendingState.error) {
    throw redirect(
      path.to.shipments,
      await flash(
        request,
        error(setPendingState.error, "Failed to post shipment")
      )
    );
  }

  try {
    const serviceRole = getCarbonServiceRole();

    // Get shipment details to check if it's related to a sales order
    const { data: shipment } = await serviceRole
      .from("shipment")
      .select("sourceDocument, sourceDocumentId, shipmentId")
      .eq("id", shipmentId)
      .single();

    // If the shipment is related to a sales order, save the packing slip PDF
    if (
      shipment?.sourceDocument === "Sales Order" &&
      shipment?.sourceDocumentId
    ) {
      try {
        // Get the opportunity ID from the sales order
        const { data: salesOrder } = await serviceRole
          .from("salesOrder")
          .select("opportunityId")
          .eq("id", shipment.sourceDocumentId)
          .single();

        if (salesOrder?.opportunityId) {
          // Generate the packing slip PDF
          const pdfArgs = {
            request,
            params: { id: shipmentId },
            context: {},
          };

          const pdf = await pdfLoader(pdfArgs);

          if (pdf.headers.get("content-type") === "application/pdf") {
            const file = await pdf.arrayBuffer();
            const fileName = stripSpecialCharacters(
              `${shipment.shipmentId} - ${new Date()
                .toISOString()
                .slice(0, -5)}.pdf`
            );

            const documentFilePath = `${companyId}/opportunity/${salesOrder.opportunityId}/${fileName}`;

            // Upload the PDF to storage
            const documentFileUpload = await serviceRole.storage
              .from("private")
              .upload(documentFilePath, file, {
                cacheControl: `${12 * 60 * 60}`,
                contentType: "application/pdf",
                upsert: true,
              });

            if (!documentFileUpload.error) {
              // Create document record
              await upsertDocument(serviceRole, {
                path: documentFilePath,
                name: fileName,
                size: Math.round(file.byteLength / 1024),
                sourceDocument: "Shipment",
                sourceDocumentId: shipmentId,
                readGroups: [userId],
                writeGroups: [userId],
                createdBy: userId,
                companyId,
              });
            }
          }
        }
      } catch (err) {
        // Continue with posting even if PDF generation fails
        console.error("Failed to generate packing slip PDF:", err);
      }
    }

    const postShipment = await serviceRole.functions.invoke("post-shipment", {
      body: {
        type: "post",
        shipmentId: shipmentId,
        userId: userId,
        companyId: companyId,
      },
      region: FunctionRegion.UsEast1,
    });

    if (postShipment.error) {
      await client
        .from("shipment")
        .update({
          status: "Draft",
        })
        .eq("id", shipmentId);

      throw redirect(
        path.to.shipmentDetails(shipmentId),
        await flash(
          request,
          error(postShipment.error, "Failed to post shipment")
        )
      );
    }
  } catch (error) {
    await client
      .from("shipment")
      .update({
        status: "Draft",
      })
      .eq("id", shipmentId);
  }

  throw redirect(path.to.shipmentDetails(shipmentId));
}
