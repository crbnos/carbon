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
import { getKanban } from "~/modules/inventory/inventory.service";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const kanban = await getKanban(client, id, companyId);
  if (kanban.error) {
    throw redirect(
      path.to.kanbans,
      await flash(request, error(kanban.error, "Failed to get kanban"))
    );
  }

  return { kanban: kanban.data };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.inventory.deleteKanban({
    kanbanId: input.params.id
  });
  return respond(args.request, result).redirect(
    `${path.to.kanbans}?${getParams(args.request)}`,
    { message: "Successfully deleted kanban", onError: path.to.kanbans }
  );
}

export default function DeleteKanbanRoute() {
  const { id } = useParams();
  if (!id) throw notFound("id not found");

  const { kanban } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!id) return null;

  const onCancel = () => navigate(path.to.kanbans);
  const kanbanName = kanban.name || kanban.itemId;

  return (
    <ConfirmDelete
      action={path.to.deleteKanban(id)}
      name={t`Kanban for ${kanbanName}`}
      text={t`Are you sure you want to delete this kanban card? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
