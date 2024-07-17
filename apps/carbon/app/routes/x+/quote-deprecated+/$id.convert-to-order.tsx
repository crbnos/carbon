import { redirect, type ActionFunctionArgs } from "@remix-run/node";
import {
  convertQuoteToOrder,
  getQuote,
  getQuoteLines,
  insertSalesOrderLines,
  upsertSalesOrder,
} from "~/modules/sales";
import { getNextSequence, rollbackNextSequence } from "~/modules/settings";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function action(args: ActionFunctionArgs) {
  const { request, params } = args;
  assertIsPost(request);

  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales",
    role: "employee",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  let newSalesOrderId: string;

  const updateQuoteStatus = await convertQuoteToOrder(client, id, userId);
  if (updateQuoteStatus.error) {
    throw redirect(
      path.to.quote(id),
      await flash(
        request,
        error(
          updateQuoteStatus.error,
          "Failed to update quote status to Ordered"
        )
      )
    );
  }

  const quote = await getQuote(client, id);
  if (quote.error) {
    throw redirect(
      path.to.quote(id),
      await flash(request, error(quote.error, "Failed to get quote"))
    );
  }

  try {
    const nextSequence = await getNextSequence(client, "salesOrder", companyId);
    if (nextSequence.error) {
      throw redirect(
        path.to.newSalesOrder,
        await flash(
          request,
          error(nextSequence.error, "Failed to get next sequence")
        )
      );
    }
    const createSalesOrder = await upsertSalesOrder(client, {
      salesOrderId: nextSequence.data,
      quoteId: quote.data.id!,
      customerId: quote.data.customerId!,
      companyId,
      createdBy: userId,
      orderDate: new Date().toISOString(),
    });

    if (createSalesOrder.error || !createSalesOrder.data?.[0]) {
      // TODO: this should be done as a transaction
      await rollbackNextSequence(client, "salesOrder", companyId);
      throw redirect(
        path.to.quotes,
        await flash(
          request,
          error(createSalesOrder.error, "Failed to insert sales order")
        )
      );
    }

    const order = createSalesOrder.data?.[0];
    newSalesOrderId = order.id;

    // construct and insert the sales order lines
    const quoteLines = await getQuoteLines(client, id);
    if (quoteLines.data) {
      const lines = quoteLines?.data.map((quoteLine) => {
        return {
          salesOrderId: newSalesOrderId,
          salesOrderLineType: "Part" as "Part",
          companyId,
          itemId: quoteLine.itemId!,
          description: quoteLine.description!,
          createdBy: userId,
        };
      });

      const salesOrderLines = await insertSalesOrderLines(client, lines);

      if (salesOrderLines.error) {
        throw redirect(
          path.to.quote(id),
          await flash(
            request,
            error(salesOrderLines.error, "Failed to create sales order lines")
          )
        );
      }
    }
  } catch (err) {
    throw redirect(
      path.to.quote(id),
      await flash(request, error(err, "Failed to create sales order"))
    );
  }
  throw redirect(
    path.to.salesOrder(newSalesOrderId),
    await flash(request, success("Quote converted to sales order"))
  );
}
