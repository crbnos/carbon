// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { rejectCrossSiteNavigation } from "@carbon/auth/middleware/security.server";
import { flash } from "@carbon/auth/session.server";
import { Loading } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { Suspense } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Await, useLoaderData } from "react-router";
import { Redirect } from "~/components/Redirect";
import {
  type KanbanScan,
  scanKanban
} from "~/modules/inventory/inventory.server";
import { serviceContext } from "~/modules/service-context.server";
import { path } from "~/utils/path";

/** Where a scan's result opens. */
function destination(kanbanId: string, scan: KanbanScan): string {
  switch (scan.type) {
    case "collision":
      return path.to.api.kanbanCollision(kanbanId);
    case "job":
      if (!scan.operationId) return path.to.job(scan.jobId);
      return scan.startAs
        ? path.to.external.mesJobOperationStart(scan.operationId, scan.startAs)
        : path.to.external.mesJobOperation(scan.operationId);
    case "purchaseOrder":
      return path.to.purchaseOrder(scan.purchaseOrderId);
    case "stockTransfer":
      return path.to.stockTransfer(scan.stockTransferId);
  }
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  // Writes on GET: a link on another site must not trigger it.
  rejectCrossSiteNavigation(request);
  const auth = await requirePermissions(request, { role: "employee" });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const scan = await scanKanban(serviceContext(auth), { kanbanId: id });
  // A redirect, not data(): the root's flash middleware clears a flash set on
  // this request.
  if (scan.data?.type === "job" && scan.data.message) {
    throw redirect(
      path.to.job(scan.data.jobId),
      await flash(request, error(null, scan.data.message))
    );
  }
  return scan.error
    ? { data: null, error: scan.error.message }
    : { data: destination(id, scan.data), error: null };
}

export default function KanbanRedirectRoute() {
  const promise = useLoaderData<typeof loader>();

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <Suspense fallback={<Loading className="size-8" isLoading />}>
        <Await resolve={promise}>
          {(resolvedPromise) => {
            if (resolvedPromise.error) {
              return <div>{resolvedPromise.error}</div>;
            }
            return <Redirect path={resolvedPromise?.data ?? ""} />;
          }}
        </Await>
      </Suspense>
    </div>
  );
}
