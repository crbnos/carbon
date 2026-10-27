// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { useResourceReferenceLabels } from "~/modules/resources/ui/useResourceReferenceLabels";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources"
  });

  const { id } = params;
  if (!id) throw notFound("Invalid work center id");

  const api = await carbon(request);
  // Read the table, not getWorkCenter: an inactive work center can be deleted too.
  const [workCenter, references] = await Promise.all([
    client
      .from("workCenter")
      .select("id, name")
      .eq("id", id)
      .eq("companyId", companyId)
      .single(),
    api.resources.getWorkCenterReferences({ id })
  ]);
  if (workCenter.error || references.error) {
    throw redirect(
      path.to.workCenters,
      await flash(
        request,
        error(workCenter.error ?? references.error, "Failed to get work center")
      )
    );
  }

  return {
    workCenter: workCenter.data,
    references: references.data
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.resources.deleteWorkCenter({
    id: input.params.id
  });
  return respond(args.request, result).redirect(path.to.workCenters, {
    message: "Successfully deleted work center"
  });
}

export default function DeleteWorkCenterRoute() {
  const { id } = useParams();
  const { workCenter, references } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();
  const usages = useResourceReferenceLabels(references);

  if (!workCenter) return null;
  if (!id) throw new Error("id is not found");

  const onCancel = () => navigate(path.to.workCenters);
  const name = workCenter.name;

  return (
    <ConfirmDelete
      action={path.to.deleteWorkCenter(id)}
      name={name}
      text={
        usages
          ? t`${name} can't be deleted because it is used by ${usages}. Deactivate it instead.`
          : t`Are you sure you want to permanently delete the work center: ${name}? This cannot be undone.`
      }
      isDisabled={!!usages}
      onCancel={onCancel}
    />
  );
}
