import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deletePaymentTerm, getPaymentTerm } from "~/modules/accounting";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting",
  });
  const { paymentTermId } = params;
  if (!paymentTermId) throw notFound("paymentTermId not found");

  const paymentTerm = await getPaymentTerm(client, paymentTermId);
  if (paymentTerm.error) {
    throw redirect(
      `${path.to.paymentTerms}?${getParams(request)}`,
      await flash(
        request,
        error(paymentTerm.error, "Failed to get payment term")
      )
    );
  }

  return json({ paymentTerm: paymentTerm.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "accounting",
  });

  const { paymentTermId } = params;
  if (!paymentTermId) {
    throw redirect(
      `${path.to.paymentTerms}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get an payment term id"))
    );
  }

  const { error: deleteTypeError } = await deletePaymentTerm(
    client,
    paymentTermId
  );
  if (deleteTypeError) {
    throw redirect(
      `${path.to.paymentTerms}?${getParams(request)}`,
      await flash(
        request,
        error(deleteTypeError, "Failed to delete payment term")
      )
    );
  }

  throw redirect(
    `${path.to.paymentTerms}?${getParams(request)}`,
    await flash(request, success("Successfully deleted payment term"))
  );
}

export default function DeletePaymentTermRoute() {
  const { paymentTermId } = useParams();
  const { paymentTerm } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!paymentTermId || !paymentTerm) return null; // TODO - handle this better (404?)

  const onCancel = () => navigate(path.to.paymentTerms);

  return (
    <ConfirmDelete
      action={path.to.deletePaymentTerm(paymentTermId)}
      name={paymentTerm.name}
      text={`Are you sure you want to delete the payment term: ${paymentTerm.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
