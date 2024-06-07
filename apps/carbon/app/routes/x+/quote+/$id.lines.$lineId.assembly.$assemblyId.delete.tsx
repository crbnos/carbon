import { json, redirect, useNavigate, useParams } from "@remix-run/react";

import type { ActionFunctionArgs } from "@remix-run/node";
import { ConfirmDelete } from "~/components/Modals";
import { useRouteData } from "~/hooks";
import type { QuotationAssembly } from "~/modules/sales";
import { deleteQuoteAssembly } from "~/modules/sales";
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

  const { id: quoteId, lineId: quoteLineId, assemblyId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!quoteLineId) throw new Error("Could not find quoteLineId");
  if (!assemblyId) throw new Error("Could not find assemblyId");

  const deleteAssembly = await deleteQuoteAssembly(client, assemblyId);

  if (deleteAssembly.error) {
    return json(
      path.to.quoteLine(quoteId, quoteLineId),
      await flash(
        request,
        error(deleteAssembly.error, "Failed to update quote assembly")
      )
    );
  }

  throw redirect(path.to.quoteLine(quoteId, quoteLineId));
}

export default function DeleteQuoteAssembly() {
  const navigate = useNavigate();

  const { id, lineId, assemblyId } = useParams();
  if (!id) throw new Error("id not found");
  if (!lineId) throw new Error("lineId not found");
  if (!assemblyId) throw new Error("assemblyId not found");

  const routeData = useRouteData<{ quoteAssembly: QuotationAssembly }>(
    path.to.quoteAssembly(id, lineId, assemblyId)
  );

  if (!routeData?.quoteAssembly) throw new Error("quote assembly not found");

  return (
    <ConfirmDelete
      action={path.to.deleteQuoteAssembly(id, lineId, assemblyId)}
      name={routeData?.quoteAssembly.itemId}
      text={`Are you sure you want to delete the assembly: ${routeData?.quoteAssembly.itemId}? This cannot be undone.`}
      onCancel={() => navigate(path.to.quoteAssembly(id, lineId, assemblyId))}
    />
  );
}
