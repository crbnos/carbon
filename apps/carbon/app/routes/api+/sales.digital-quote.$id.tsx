import { assertIsPost, getCarbonServiceRole, notFound } from "@carbon/auth";
import { NotificationEvent } from "@carbon/notifications";
import { tasks } from "@trigger.dev/sdk/v3";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import {
  convertQuoteToOrder,
  getOpportunityByQuote,
  getQuoteByExternalId,
  selectedLinesValidator,
} from "~/modules/sales";
import { getCompany } from "~/modules/settings";
import type { notifyTask } from "~/trigger/notify";

export const config = {
  runtime: "nodejs",
};

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { id } = params;
  if (!id) throw notFound("id not found");

  const formData = await request.formData();
  const selectedLinesRaw = formData.get("selectedLines") ?? "{}";
  const digitalQuoteAcceptedBy = String(formData.get("digitalQuoteAcceptedBy"));
  const digitalQuoteAcceptedByEmail = String(
    formData.get("digitalQuoteAcceptedByEmail")
  );
  const file = formData.get("file");

  if (typeof selectedLinesRaw !== "string") {
    return json({ success: false, message: "Invalid selected lines data" });
  }

  const parseResult = selectedLinesValidator.safeParse(
    JSON.parse(selectedLinesRaw)
  );

  if (!parseResult.success) {
    console.error("Validation error:", parseResult.error);
    return json({ success: false, message: "Invalid selected lines data" });
  }

  const selectedLines = parseResult.data;

  const serviceRole = getCarbonServiceRole();
  const quote = await getQuoteByExternalId(serviceRole, id);

  if (quote.error) {
    console.error("Quote not found", quote.error);
    return json({
      success: false,
      message: "Quote not found",
    });
  }
  const [convert, company, opportunity] = await Promise.all([
    convertQuoteToOrder(serviceRole, {
      id: quote.data.id,
      companyId: quote.data.companyId,
      userId: quote.data.createdBy,
      selectedLines,
      digitalQuoteAcceptedBy,
      digitalQuoteAcceptedByEmail,
    }),
    getCompany(serviceRole, quote.data.companyId),
    getOpportunityByQuote(serviceRole, quote.data.id),
  ]);

  if (convert.error) {
    console.error("Failed to convert quote to order", convert.error);
    return json({
      success: false,
      message: "Failed to convert quote to order",
    });
  }

  if (company.error) {
    console.error("Failed to get company", company.error);
    return json({
      success: false,
      message: "Failed to send notification",
    });
  }

  if (opportunity.error) {
    console.error("Failed to get opportunity", opportunity.error);
    return json({
      success: false,
      message: "Failed to send notification",
    });
  }

  if (company.data?.digitalQuoteNotificationGroup?.length) {
    try {
      await tasks.trigger<typeof notifyTask>("notify", {
        companyId: company.data.id,
        documentId: quote.data.id,
        event: NotificationEvent.DigitalQuoteResponse,
        recipient: {
          type: "group",
          groupIds: company.data?.digitalQuoteNotificationGroup ?? [],
        },
      });
    } catch (err) {
      console.error("Failed to trigger notification", err);
      return json({
        success: false,
        message: "Failed to send notification",
      });
    }
  }

  if (file && file instanceof File) {
    const purchaseOrderDocumentPath = `${company.data.id}/opportunity/${opportunity.data.id}/${file.name}`;

    const fileUpload = await serviceRole.storage
      .from("private")
      .upload(purchaseOrderDocumentPath, file);

    if (fileUpload.error) {
      console.error("Failed to upload file", fileUpload.error);
      return json({
        success: false,
        message: "Failed to upload file",
      });
    }

    const updateOpportunity = await serviceRole
      .from("opportunity")
      .update({
        purchaseOrderDocumentPath,
      })
      .eq("id", opportunity.data?.id!);

    if (updateOpportunity.error) {
      console.error("Failed to update opportunity", updateOpportunity.error);
    }
  }

  return json({
    success: true,
    message: "Quote accepted!",
  });
}
