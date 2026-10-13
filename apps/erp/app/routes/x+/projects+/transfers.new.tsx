// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import type { ProjectStockTransferType } from "~/modules/projects";
import {
  COMMON_STOCK_OWNER,
  getProjectBorrows,
  getStockOwnerProjects,
  projectStockTransferTypes,
  projectStockTransferValidator,
  toStockOwner,
  upsertProjectStockTransfer
} from "~/modules/projects";
import ProjectStockTransferForm from "~/modules/projects/ui/Transfers/ProjectStockTransferForm";
import { getUserDefaults } from "~/modules/users/users.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-stock-transfer-new");

/**
 * The owners and open borrows the form offers. `?type`, `?from`, `?to`
 * and `?borrow` prefill it (the project Stock tab's buttons).
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "projects"
  });

  const searchParams = new URL(request.url).searchParams;
  const [owners, openBorrows, userDefaults] = await Promise.all([
    getStockOwnerProjects(client, companyId),
    getProjectBorrows(client, companyId, { status: ["Open"] }),
    getUserDefaults(client, userId, companyId)
  ]);

  const typeParam = searchParams.get("type");
  const type: ProjectStockTransferType = projectStockTransferTypes.includes(
    typeParam as ProjectStockTransferType
  )
    ? (typeParam as ProjectStockTransferType)
    : "Transfer";

  return {
    owners: (owners.data ?? []).filter((p) => p.status !== "Closed"),
    openBorrows: openBorrows.data ?? [],
    initialValues: {
      type,
      fromProjectId: searchParams.get("from") ?? COMMON_STOCK_OWNER,
      toProjectId: searchParams.get("to") ?? undefined,
      locationId: userDefaults.data?.locationId ?? undefined,
      settlesBorrowId: searchParams.get("borrow") ?? undefined,
      reason: ""
    }
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "projects"
  });

  const validation = await validator(projectStockTransferValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const { type, reason, settlesBorrowId } = validation.data;
  let fromProjectId = toStockOwner(validation.data.fromProjectId);
  let toProjectId = toStockOwner(validation.data.toProjectId);
  let locationId = validation.data.locationId ?? "";

  // A Payback runs from the borrower back to the lender, at the borrow's
  // location: the header names both owners (the owner CHECK needs one).
  if (type === "Payback") {
    const borrow = await client
      .from("projectBorrow")
      .select("borrowerProjectId, lenderProjectId, locationId, status")
      .eq("id", settlesBorrowId!)
      .eq("companyId", companyId)
      .single();
    if (borrow.error || borrow.data.status !== "Open") {
      return data(
        {},
        await flash(
          request,
          error(borrow.error, "Select an open borrow to pay back")
        )
      );
    }
    fromProjectId = borrow.data.borrowerProjectId;
    toProjectId = borrow.data.lenderProjectId;
    locationId = borrow.data.locationId;
  }

  const created = await upsertProjectStockTransfer(client, {
    type,
    fromProjectId,
    toProjectId,
    locationId,
    reason,
    paybackDueDate:
      type === "Borrow" ? (validation.data.paybackDueDate ?? null) : null,
    settlesBorrowId: type === "Payback" ? (settlesBorrowId ?? null) : null,
    companyId,
    createdBy: userId
  });

  if (created.error || !created.data) {
    logger.error("Failed to create a project stock transfer", {
      companyId,
      error: created.error
    });
    return data(
      {},
      await flash(
        request,
        error(created.error, "Failed to create the transfer")
      )
    );
  }

  throw redirect(
    path.to.projectStockTransfer(created.data.id),
    await flash(request, success("Transfer created"))
  );
}

export default function NewProjectStockTransferRoute() {
  const { owners, openBorrows, initialValues } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();
  return (
    <ProjectStockTransferForm
      initialValues={initialValues}
      owners={owners}
      openBorrows={openBorrows}
      onClose={() => closeRoute()}
    />
  );
}
