// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { PartMethodPage } from "~/modules/items/items.service";
import { OperationWorkspace } from "~/modules/items/ui/Item/OperationWorkspace";
import { getProcedure } from "~/modules/production/production.service";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const { operationId } = params;
  if (!operationId) throw new Error("Could not find operationId");

  const operation = await client
    .from("methodOperation")
    .select("procedureId")
    .eq("id", operationId)
    .eq("companyId", companyId)
    .maybeSingle();

  const procedure = operation.data?.procedureId
    ? await getProcedure(client, operation.data.procedureId)
    : null;

  return { procedure: procedure?.data ?? null };
}

export default function PartBillOfProcessOperationRoute() {
  const { itemId, operationId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  if (!operationId) throw new Error("Could not find operationId");

  const { procedure } = useLoaderData<typeof loader>();
  const page = useRouteData<PartMethodPage>(path.to.partBillOfProcess(itemId));
  if (!page) return null;

  return (
    <OperationWorkspace
      itemId={itemId}
      page={page}
      operationId={operationId}
      procedure={procedure}
    />
  );
}
