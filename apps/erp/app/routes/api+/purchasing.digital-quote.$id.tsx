import { assertIsPost, getCarbonServiceRole, notFound } from "@carbon/auth";
import { validationError, validator } from "@carbon/form";
import type { notifyTask } from "@carbon/jobs/trigger/notify";
import { NotificationEvent } from "@carbon/notifications";
import { tasks } from "@trigger.dev/sdk";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  externalSupplierQuoteValidator,
  selectedLineSchema
} from "~/modules/purchasing/purchasing.models";
import { getSupplierQuoteByExternalLinkId } from "~/modules/purchasing/purchasing.service";
import { getCompanySettings } from "~/modules/settings";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { id } = params;
  if (!id) throw notFound("id not found");

  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  const serviceRole = getCarbonServiceRole();
  const quote = await getSupplierQuoteByExternalLinkId(serviceRole, id);

  if (quote.error || !quote.data) {
    console.error("Quote not found", quote.error);
    return {
      success: false,
      message: "Quote not found"
    };
  }

  const companySettings = await getCompanySettings(
    serviceRole,
    quote.data.companyId
  );

  switch (intent) {
    case "decline": {
      const validation = await validator(
        externalSupplierQuoteValidator
      ).validate(formData);

      if (validation.error) {
        return validationError(validation.error);
      }

      const {
        digitalSupplierQuoteSubmittedBy,
        digitalSupplierQuoteSubmittedByEmail,
        note
      } = validation.data;
      const now = new Date().toISOString();

      // Update supplierQuote
      await serviceRole
        .from("supplierQuote")
        .update({
          status: "Declined",
          updatedAt: now,
          externalNotes: {
            ...((quote.data.externalNotes as Record<string, unknown>) || {}),
            declineNote: note ?? null,
            declinedBy: digitalSupplierQuoteSubmittedBy,
            declinedByEmail: digitalSupplierQuoteSubmittedByEmail,
            declinedAt: now
          }
        })
        .eq("id", quote.data.id);

      // Update externalLink if it exists
      if (quote.data.externalLinkId) {
        await serviceRole
          .from("externalLink")
          .update({
            declinedAt: now,
            declinedBy: digitalSupplierQuoteSubmittedBy,
            declinedByEmail: digitalSupplierQuoteSubmittedByEmail,
            declineNote: note ?? null
          } as any)
          .eq("id", quote.data.externalLinkId);
      }

      return {
        success: true,
        message: "Quote declined successfully"
      };
    }

    case "submit": {
      const validation = await validator(
        externalSupplierQuoteValidator
      ).validate(formData);

      if (validation.error) {
        return validationError(validation.error);
      }

      const {
        digitalSupplierQuoteSubmittedBy,
        digitalSupplierQuoteSubmittedByEmail
      } = validation.data;

      const selectedLinesRaw = formData.get("selectedLines") ?? "{}";

      if (typeof selectedLinesRaw !== "string") {
        return { success: false, message: "Invalid selected lines data" };
      }

      let parsedData: unknown;
      try {
        parsedData = JSON.parse(selectedLinesRaw);
        // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
      } catch (e) {
        return {
          success: false,
          message: "Invalid JSON in selected lines data"
        };
      }

      // selectedLines is Record<string, Record<number, SelectedLine>>
      // where first key is lineId, second key is quantity
      // Validate the nested structure
      const nestedSelectedLinesValidator = z.record(
        z.string(),
        z.record(z.string(), selectedLineSchema)
      );

      const parseResult = nestedSelectedLinesValidator.safeParse(parsedData);

      if (!parseResult.success) {
        console.error("Validation error:", parseResult.error);
        return { success: false, message: "Invalid selected lines data" };
      }

      const selectedLines = parseResult.data;

      // Update prices for all selected quantities across all lines
      // First, collect all price records that need to be updated/inserted
      const priceRecordsToProcess: Array<{
        lineId: string;
        quantity: number;
        selectedLine: z.infer<typeof selectedLineSchema>;
      }> = [];

      for (const [lineId, lineSelections] of Object.entries(selectedLines)) {
        // lineSelections is Record<number, SelectedLine>
        for (const [quantityStr, selectedLine] of Object.entries(
          lineSelections
        )) {
          const quantity = Number(quantityStr);

          // Only process if quantity > 0 (line is selected)
          if (quantity > 0 && selectedLine.quantity > 0) {
            priceRecordsToProcess.push({
              lineId,
              quantity,
              selectedLine
            });
          }
        }
      }

      // Batch check which price records exist
      const existingPriceChecks = await Promise.all(
        priceRecordsToProcess.map(({ lineId, quantity }) =>
          serviceRole
            .from("supplierQuoteLinePrice")
            .select("id")
            .eq("supplierQuoteLineId", lineId)
            .eq("quantity", quantity)
            .maybeSingle()
        )
      );

      // Prepare updates and inserts
      const priceUpdates = [];
      const priceInserts = [];

      for (let i = 0; i < priceRecordsToProcess.length; i++) {
        const { lineId, quantity, selectedLine } = priceRecordsToProcess[i];
        const existingPrice = existingPriceChecks[i];

        if (existingPrice.data) {
          // Update existing price record
          priceUpdates.push(
            serviceRole
              .from("supplierQuoteLinePrice")
              .update({
                supplierUnitPrice: selectedLine.supplierUnitPrice ?? 0,
                leadTime: selectedLine.leadTime ?? 0,
                supplierShippingCost: selectedLine.supplierShippingCost ?? 0,
                supplierTaxAmount: selectedLine.supplierTaxAmount ?? 0,
                updatedAt: new Date().toISOString(),
                updatedBy: quote.data.createdBy
              })
              .eq("supplierQuoteLineId", lineId)
              .eq("quantity", quantity)
          );
        } else {
          // Insert new price record
          priceInserts.push({
            supplierQuoteId: quote.data.id,
            supplierQuoteLineId: lineId,
            quantity: quantity,
            supplierUnitPrice: selectedLine.supplierUnitPrice ?? 0,
            leadTime: selectedLine.leadTime ?? 0,
            supplierShippingCost: selectedLine.supplierShippingCost ?? 0,
            supplierTaxAmount: selectedLine.supplierTaxAmount ?? 0,
            exchangeRate: quote.data.exchangeRate ?? 1,
            createdBy: quote.data.createdBy
          });
        }
      }

      // Execute all updates and inserts
      await Promise.all([
        ...priceUpdates,
        priceInserts.length > 0
          ? serviceRole.from("supplierQuoteLinePrice").insert(priceInserts)
          : Promise.resolve({ data: null, error: null })
      ]);

      const now = new Date().toISOString();

      // Update quote status to Active (submit moves from Draft to Active)
      await serviceRole
        .from("supplierQuote")
        .update({
          status: "Active",
          updatedAt: now,
          externalNotes: {
            ...((quote.data.externalNotes as Record<string, unknown>) || {}),
            lastSubmittedBy: digitalSupplierQuoteSubmittedBy,
            lastSubmittedByEmail: digitalSupplierQuoteSubmittedByEmail,
            lastSubmittedAt: now
          }
        })
        .eq("id", quote.data.id);

      // Update externalLink if it exists
      if (quote.data.externalLinkId) {
        await serviceRole
          .from("externalLink")
          .update({
            submittedAt: now,
            submittedBy: digitalSupplierQuoteSubmittedBy,
            submittedByEmail: digitalSupplierQuoteSubmittedByEmail
          } as any)
          .eq("id", quote.data.externalLinkId);
      }

      if (companySettings.error) {
        console.error("Failed to get company settings", companySettings.error);
      }

      // Send notification to supplier quote notification group
      if (companySettings.data?.supplierQuoteNotificationGroup?.length) {
        try {
          await tasks.trigger<typeof notifyTask>("notify", {
            companyId: companySettings.data.id,
            documentId: quote.data.id,
            event: NotificationEvent.SupplierQuoteResponse,
            recipient: {
              type: "group",
              groupIds: companySettings.data.supplierQuoteNotificationGroup
            }
          });
        } catch (err) {
          console.error("Failed to trigger supplier quote notification", err);
        }
      }

      return {
        success: true,
        message: "Quote submitted successfully"
      };
    }

    case "updateNotes": {
      const lineId = formData.get("lineId");
      const notesRaw = formData.get("notes");

      if (!lineId || typeof lineId !== "string") {
        return { success: false, message: "Invalid line ID" };
      }

      let notes = null;
      if (notesRaw && typeof notesRaw === "string") {
        try {
          notes = JSON.parse(notesRaw);
          // biome-ignore lint/correctness/noUnusedVariables: suppressed
        } catch (e) {
          return { success: false, message: "Invalid notes format" };
        }
      }

      // Update the supplierQuoteLine with the new notes
      const updateResult = await serviceRole
        .from("supplierQuoteLine")
        .update({
          externalNotes: notes,
          updatedAt: new Date().toISOString()
        })
        .eq("id", lineId)
        .eq("supplierQuoteId", quote.data.id);

      if (updateResult.error) {
        console.error("Failed to update notes", updateResult.error);
        return { success: false, message: "Failed to update notes" };
      }

      return {
        success: true,
        message: "Notes updated successfully"
      };
    }

    default:
      return { success: false, message: "Invalid intent" };
  }
}
