import { json, redirect, useNavigate, useParams } from "@remix-run/react";

import type { ActionFunctionArgs } from "@remix-run/node";
import { ConfirmDelete } from "~/components/Modals";
import { useRouteData } from "~/hooks";
import type { QuotationLine } from "~/modules/sales";
import { deleteQuoteLine } from "~/modules/sales";
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

  const { id: quoteId, lineId: quoteLineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!quoteLineId) throw new Error("Could not find quoteLineId");

  const deleteLine = await deleteQuoteLine(client, quoteLineId);

  if (deleteLine.error) {
    return json(
      path.to.quoteLine(quoteId, quoteLineId),
      await flash(
        request,
        error(deleteLine.error, "Failed to update quote line")
      )
    );
  }

  throw redirect(path.to.quote(quoteId));
}

export default function DeleteQuoteLine() {
  const { id, lineId } = useParams();
  if (!id) throw new Error("id not found");
  if (!lineId) throw new Error("lineId not found");

  const routeData = useRouteData<{ quotationLine: QuotationLine }>(
    path.to.quoteLine(id, lineId)
  );
  const navigate = useNavigate();

  if (!routeData?.quotationLine) throw new Error("quote line not found");

  const onCancel = () => navigate(path.to.quoteLine(id, lineId));

  return (
    <ConfirmDelete
      action={path.to.deleteQuoteLine(id, lineId)}
      name={routeData?.quotationLine.itemReadableId ?? "this line"}
      text={`Are you sure you want to delete the line: ${routeData?.quotationLine.itemReadableId}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
