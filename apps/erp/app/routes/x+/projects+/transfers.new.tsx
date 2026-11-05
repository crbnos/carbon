// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import type { ProjectStockTransferType } from "~/modules/projects/projects.models";
import {
  COMMON_STOCK_OWNER,
  projectStockTransferTypes,
  projectStockTransferValidator
} from "~/modules/projects/projects.models";
import {
  getProjectBorrows,
  getStockOwnerProjects
} from "~/modules/projects/projects.service";
import ProjectStockTransferForm from "~/modules/projects/ui/Transfers/ProjectStockTransferForm";
import { getUserDefaults } from "~/modules/users/users.service";
import { path } from "~/utils/path";

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

  const validation = await validator(projectStockTransferValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const { id: _id, ...fields } = validation.data;
  const api = await carbon(request);
  const created = await api.projects.upsertProjectStockTransfer(fields);

  if (created.error) {
    // A Payback that names no open borrow says so; anything else is a
    // failure to create.
    return data(
      {},
      await flash(
        request,
        error(
          null,
          created.error.category === "validation"
            ? created.error.message
            : "Failed to create the transfer"
        )
      )
    );
  }

  if (!created.data) {
    return data(
      {},
      await flash(request, error(null, "Failed to create the transfer"))
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
