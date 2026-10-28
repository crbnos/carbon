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
import { getProcess } from "~/modules/resources/resources.service";
import { useResourceReferenceLabels } from "~/modules/resources/ui/useResourceReferenceLabels";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });

  const { processId } = params;
  if (!processId) throw notFound("processId not found");

  const api = await carbon(request);
  const [process, references] = await Promise.all([
    getProcess(client, processId),
    api.resources.getProcessReferences({ processId })
  ]);
  if (process.error || references.error) {
    throw redirect(
      path.to.processes,
      await flash(
        request,
        error(process.error ?? references.error, "Failed to get process")
      )
    );
  }

  return {
    process: process.data,
    references: references.data
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["processId"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.resources.deleteProcess({
    processId: input.params.processId
  });
  return respond(args.request, result).redirect(path.to.processes, {
    message: "Successfully deleted process"
  });
}

export default function DeleteProcessRoute() {
  const { processId } = useParams();
  const { process, references } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();
  const usages = useResourceReferenceLabels(references);

  if (!process) return null;
  if (!processId) throw new Error("processId is not found");

  const onCancel = () => navigate(path.to.processes);
  const name = process.name ?? "";

  return (
    <ConfirmDelete
      action={path.to.deleteProcess(processId)}
      name={name}
      text={
        usages
          ? t`${name} can't be deleted because it is used by ${usages}. Deactivate it instead.`
          : t`Are you sure you want to permanently delete the process: ${name}? This cannot be undone.`
      }
      isDisabled={!!usages}
      onCancel={onCancel}
    />
  );
}
