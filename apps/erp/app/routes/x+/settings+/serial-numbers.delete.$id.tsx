import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deleteItemSerialSequence,
  getItemSerialSequence
} from "~/modules/settings";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const itemSerialSequence = await getItemSerialSequence(client, id, companyId);
  if (itemSerialSequence.error) {
    throw redirect(
      path.to.serialNumberSequences,
      await flash(
        request,
        error(itemSerialSequence.error, "Failed to load serial number")
      )
    );
  }

  return { itemSerialSequence: itemSerialSequence.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "settings"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const { error: deleteError } = await deleteItemSerialSequence(
    client,
    id,
    companyId
  );
  if (deleteError) {
    throw redirect(
      `${path.to.serialNumberSequences}?${getParams(request)}`,
      await flash(request, error(deleteError, "Failed to delete serial number"))
    );
  }

  throw redirect(
    `${path.to.serialNumberSequences}?${getParams(request)}`,
    await flash(request, success("Deleted serial number"))
  );
}

export default function DeleteSerialNumberRoute() {
  const { itemSerialSequence } = useLoaderData<typeof loader>();

  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const navigate = useNavigate();
  const { t } = useLingui();
  const onCancel = () => navigate(-1);

  const itemLabel = itemSerialSequence.itemReadableId ?? t`this item`;

  return (
    <ConfirmDelete
      action={path.to.deleteSerialNumberSequence(id)}
      name={itemLabel}
      text={t`Are you sure you want to delete the serial number sequence for ${itemLabel}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
