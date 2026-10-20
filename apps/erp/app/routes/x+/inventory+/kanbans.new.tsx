// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useSearchParams } from "react-router";
import { useUser } from "~/hooks";
import { kanbanValidator } from "~/modules/inventory/inventory.models";
import { KanbanForm } from "~/modules/inventory/ui";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "inventory"
  });

  return null;
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(kanbanValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { id: _, ...kanban } = input.data;
  const api = await carbon(args.request);
  const result = await api.inventory.createKanban(kanban);
  const { pathname, search } = new URL(args.request.url);
  return respond(args.request, result).redirect(
    `${path.to.kanbans}?${getParams(args.request)}`,
    { message: "Kanban created", onError: `${pathname}${search}` }
  );
}

export default function NewKanbanRoute() {
  const closeRoute = useCloseRoute();
  const [searchParams] = useSearchParams();
  const { defaults } = useUser();
  const locationId =
    (searchParams.get("location") || defaults.locationId) ?? "";

  const initialValues = {
    itemId: "",
    quantity: 1,
    replenishmentSystem: "Buy" as const,
    locationId,
    conversionFactor: 1,
    autoRelease: false,
    autoStartJob: false,
    completedBarcodeOverride: ""
  };

  return (
    <KanbanForm
      initialValues={initialValues}
      locationId={locationId}
      onClose={() => closeRoute()}
    />
  );
}
