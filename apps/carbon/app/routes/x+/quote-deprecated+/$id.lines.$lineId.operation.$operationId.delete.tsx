import { json, redirect, useNavigate, useParams } from "@remix-run/react";

import type { ActionFunctionArgs } from "@remix-run/node";
import { ConfirmDelete } from "~/components/Modals";
import { useRouteData } from "~/hooks";
import type { QuotationOperation } from "~/modules/sales";
import { deleteQuoteOperation } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    update: "sales",
  });

  const { id: quoteId, lineId: quoteLineId, operationId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!quoteLineId) throw new Error("Could not find quoteLineId");
  if (!operationId) throw new Error("Could not find operationId");

  const deleteOperation = await deleteQuoteOperation(client, operationId);

  if (deleteOperation.error) {
    return json(
      path.to.quoteLine(quoteId, quoteLineId),
      await flash(
        request,
        error(deleteOperation.error, "Failed to update quote operation")
      )
    );
  }

  throw redirect(path.to.quoteLine(quoteId, quoteLineId));
}

export default function DeleteQuoteOperation() {
  const navigate = useNavigate();

  const { id, lineId, operationId } = useParams();
  if (!id) throw new Error("id not found");
  if (!lineId) throw new Error("lineId not found");
  if (!operationId) throw new Error("operationId not found");

  const routeData = useRouteData<{ quoteOperation: QuotationOperation }>(
    path.to.quoteOperation(id, lineId, operationId)
  );

  if (!routeData?.quoteOperation) throw new Error("quote operation not found");

  return (
    <ConfirmDelete
      name={routeData.quoteOperation.description ?? "Operation"}
      text={`Are you sure you want to delete the operation? This cannot be undone.`}
      onCancel={() => navigate(path.to.quoteOperation(id, lineId, operationId))}
    />
  );
}
