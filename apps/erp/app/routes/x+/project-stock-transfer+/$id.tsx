// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { DocumentPage } from "~/components/DocumentPage";
import {
  projectStockTransferValidator,
  toStockOwner
} from "~/modules/projects/projects.models";
import {
  getProjectBorrows,
  getProjectStockTransfer,
  getProjectStockTransferLines,
  getStockOwnerProjects,
  upsertProjectStockTransfer
} from "~/modules/projects/projects.service";
import ProjectStockTransferDetails from "~/modules/projects/ui/Transfers/ProjectStockTransferDetails";
import ProjectStockTransferHeader from "~/modules/projects/ui/Transfers/ProjectStockTransferHeader";
import ProjectStockTransferLines from "~/modules/projects/ui/Transfers/ProjectStockTransferLines";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path, requestReferrer } from "~/utils/path";

const logger = getLogger("erp", "project-stock-transfer");

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Transfers`, to: path.to.projectStockTransfers },
    (data) => data?.transfer?.projectStockTransferId
  ),
  module: "projects"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [transfer, lines, owners] = await Promise.all([
    getProjectStockTransfer(client, companyId, id),
    getProjectStockTransferLines(client, companyId, id),
    getStockOwnerProjects(client, companyId)
  ]);

  if (transfer.error) {
    logger.error("Failed to load project stock transfer", {
      companyId,
      id,
      error: transfer.error
    });
    throw redirect(
      path.to.projectStockTransfers,
      await flash(request, error(transfer.error, "Failed to load the transfer"))
    );
  }

  // A Payback shows the borrow it settles.
  const borrow =
    transfer.data.type === "Payback" && transfer.data.fromProjectId
      ? ((
          await getProjectBorrows(client, companyId, {
            projectId: transfer.data.fromProjectId
          })
        ).data?.find((b) => b.id === transfer.data.settlesBorrowId) ?? null)
      : null;

  return {
    transfer: transfer.data,
    lines: lines.data ?? [],
    owners: (owners.data ?? []).filter((p) => p.status !== "Closed"),
    borrow
  };
}

/** Saves the header of a Draft transfer. Its type never changes. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "projects"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const validation = await validator(projectStockTransferValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const current = await getProjectStockTransfer(client, companyId, id);
  if (current.error) {
    return data(
      {},
      await flash(request, error(current.error, "Failed to load the transfer"))
    );
  }

  // A Payback keeps the owners and location of its borrow.
  const isPayback = current.data.type === "Payback";
  const updated = await upsertProjectStockTransfer(client, {
    id,
    companyId,
    updatedBy: userId,
    fromProjectId: isPayback
      ? current.data.fromProjectId
      : toStockOwner(validation.data.fromProjectId),
    toProjectId: isPayback
      ? current.data.toProjectId
      : toStockOwner(validation.data.toProjectId),
    locationId: isPayback
      ? current.data.locationId
      : (validation.data.locationId ?? current.data.locationId),
    reason: validation.data.reason,
    paybackDueDate:
      current.data.type === "Borrow"
        ? (validation.data.paybackDueDate ?? null)
        : null,
    settlesBorrowId: current.data.settlesBorrowId
  });

  if (updated.error) {
    return data(
      {},
      await flash(request, error(updated.error, "Failed to save the transfer"))
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.projectStockTransfer(id),
    await flash(request, success("Updated transfer"))
  );
}

export default function ProjectStockTransferRoute() {
  const { transfer, lines, owners, borrow } = useLoaderData<typeof loader>();

  return (
    <>
      <DocumentPage
        header={
          <ProjectStockTransferHeader
            transfer={transfer}
            lineCount={lines.length}
          />
        }
      >
        <ProjectStockTransferDetails
          key={transfer.updatedAt ?? transfer.id}
          transfer={transfer}
          owners={owners}
          borrow={borrow}
        />
        <ProjectStockTransferLines transfer={transfer} lines={lines} />
      </DocumentPage>
      <RecordOutlet />
    </>
  );
}
