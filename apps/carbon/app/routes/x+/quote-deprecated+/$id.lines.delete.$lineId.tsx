import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import { ConfirmDelete } from "~/components/Modals";
import { deleteQuoteLine, getQuoteLine } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "sales",
  });
  const { lineId, id } = params;
  if (!lineId) throw notFound("lineId not found");
  if (!id) throw notFound("id not found");

  const quotationLine = await getQuoteLine(client, lineId);
  if (quotationLine.error) {
    throw redirect(
      path.to.quote(id),
      await flash(
        request,
        error(quotationLine.error, "Failed to get quotation line")
      )
    );
  }

  return json({ quotationLine: quotationLine.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "sales",
  });

  const { lineId, id } = params;
  if (!lineId) throw notFound("Could not find lineId");
  if (!id) throw notFound("Could not find id");

  const { error: deleteTypeError } = await deleteQuoteLine(client, lineId);
  if (deleteTypeError) {
    throw redirect(
      path.to.quote(id),
      await flash(
        request,
        error(deleteTypeError, "Failed to delete quotation line")
      )
    );
  }

  throw redirect(
    path.to.quote(id),
    await flash(request, success("Successfully deleted quotation line"))
  );
}

export default function DeleteQuoteLineRoute() {
  const { lineId, id } = useParams();
  const { quotationLine } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!quotationLine) return null;
  if (!lineId) throw notFound("Could not find lineId");
  if (!id) throw notFound("Could not find id");

  const onCancel = () => navigate(path.to.quote(id));

  return (
    <ConfirmDelete
      action={path.to.deleteQuoteLine(id, lineId)}
      name="Quote Line"
      text={`Are you sure you want to delete the quotation line for ${quotationLine.itemReadableId}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
