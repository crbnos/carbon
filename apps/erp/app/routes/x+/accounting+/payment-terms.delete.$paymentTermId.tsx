import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deletePaymentTerm,
  getPaymentTerm
} from "~/modules/accounting/accounting.service.server";
import { getParams, path } from "~/utils/path";
import { getCompanyId, paymentTermsQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "accounting"
  });
  const { paymentTermId } = params;
  if (!paymentTermId) throw notFound("paymentTermId not found");

  const paymentTerm = await getPaymentTerm(paymentTermId);
  if (paymentTerm.error) {
    throw redirect(
      `${path.to.paymentTerms}?${getParams(request)}`,
      await flash(
        request,
        error(paymentTerm.error, "Failed to get payment term")
      )
    );
  }

  return { paymentTerm: paymentTerm.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "accounting"
  });

  const { paymentTermId } = params;
  if (!paymentTermId) {
    throw redirect(
      `${path.to.paymentTerms}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get an payment term id"))
    );
  }

  const { error: deleteTypeError } = await deletePaymentTerm(paymentTermId);
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

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    paymentTermsQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function DeletePaymentTermRoute() {
  const { paymentTermId } = useParams();
  const { paymentTerm } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!paymentTermId || !paymentTerm) return null; // TODO - handle this better (404?)

  const onCancel = () => navigate(path.to.paymentTerms);

  return (
    <ConfirmDelete
      action={path.to.deletePaymentTerm(paymentTermId)}
      name={paymentTerm.name}
      text={t`Are you sure you want to delete the payment term: ${paymentTerm.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
