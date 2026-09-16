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
  deleteUnitOfMeasure,
  getUnitOfMeasure,
  getUnitOfMeasureUsage
} from "~/modules/items";
import { getParams, path } from "~/utils/path";
import { getCompanyId, uomsQuery } from "~/utils/react-query";
import { camelCaseToWords } from "~/utils/string";

// "purchase order line (12), item (4)" — humanized table names, no lookup to maintain.
function describeUsage(usage: { tableName: string; count: number }[]) {
  return usage
    .map(
      (u) =>
        `${camelCaseToWords(u.tableName).trim().toLowerCase()} (${u.count})`
    )
    .join(", ");
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  const { uomId } = params;
  if (!uomId) throw notFound("uomId not found");

  const unitOfMeasure = await getUnitOfMeasure(client, uomId, companyId);
  if (unitOfMeasure.error) {
    throw redirect(
      `${path.to.uoms}?${getParams(request)}`,
      await flash(
        request,
        error(unitOfMeasure.error, "Failed to get unit of measure")
      )
    );
  }

  // Checked up front so the modal can explain before the DB guard has to.
  const usage = await getUnitOfMeasureUsage(client, uomId);
  if (usage.error) {
    throw redirect(
      `${path.to.uoms}?${getParams(request)}`,
      await flash(
        request,
        error(usage.error, "Failed to check where the unit of measure is used")
      )
    );
  }

  return {
    unitOfMeasure: unitOfMeasure.data,
    usage: usage.data ?? []
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "parts"
  });

  const { uomId } = params;
  if (!uomId) {
    throw redirect(
      path.to.uoms,
      await flash(request, error(params, "Failed to get an unit of measure id"))
    );
  }

  // Re-checked: the code may have been put on a document while the modal was open.
  const usage = await getUnitOfMeasureUsage(client, uomId);
  if (usage.error) {
    throw redirect(
      path.to.uoms,
      await flash(
        request,
        error(usage.error, "Failed to check where the unit of measure is used")
      )
    );
  }

  const inUse = usage.data ?? [];
  if (inUse.length > 0) {
    throw redirect(
      path.to.uoms,
      await flash(
        request,
        error(
          inUse,
          `Cannot delete a unit of measure that is in use: ${describeUsage(inUse)}`
        )
      )
    );
  }

  const { error: deleteTypeError } = await deleteUnitOfMeasure(client, uomId);
  if (deleteTypeError) {
    throw redirect(
      path.to.uoms,
      await flash(
        request,
        // The trigger's refusal names the referencing tables — show it.
        error(
          deleteTypeError,
          deleteTypeError.message || "Failed to delete unit of measure"
        )
      )
    );
  }

  throw redirect(
    path.to.uoms,
    await flash(request, success("Successfully deleted unit of measure"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(uomsQuery(getCompanyId()).queryKey, null);
  return await serverAction();
}

export default function DeleteUnitOfMeasureRoute() {
  const { uomId } = useParams();
  const { unitOfMeasure, usage } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!unitOfMeasure) return null;
  if (!uomId) throw notFound("uomId not found");

  const onCancel = () => navigate(path.to.uoms);
  const isInUse = usage.length > 0;
  const where = describeUsage(usage);

  return (
    <ConfirmDelete
      action={path.to.deleteUom(uomId)}
      name={unitOfMeasure.name}
      isDisabled={isInUse}
      text={
        isInUse
          ? t`${unitOfMeasure.name} cannot be deleted because it is still in use by ${where}. Change those records to a different unit of measure first.`
          : t`Are you sure you want to delete the unit of measure: ${unitOfMeasure.name}? This cannot be undone.`
      }
      onCancel={onCancel}
    />
  );
}
