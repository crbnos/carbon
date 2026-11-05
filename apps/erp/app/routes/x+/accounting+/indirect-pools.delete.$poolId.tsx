// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getIndirectPool } from "@carbon/ee/indirect-rates.server";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { path } from "~/utils/path";

const logger = getLogger("erp", "indirect-pool-delete");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "accounting"
  });

  const { poolId } = params;
  if (!poolId) throw notFound("Pool ID was not found");

  const pool = await getIndirectPool(client, poolId, companyId);
  if (pool.error || !pool.data) {
    logger.error("Failed to load an indirect pool", {
      companyId,
      poolId,
      error: pool.error
    });
    throw redirect(
      path.to.indirectPools,
      await flash(request, error(pool.error, "Failed to load the pool"))
    );
  }

  return { pool: pool.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { poolId } = params;
  if (!poolId) throw notFound("Pool ID was not found");

  const api = await carbon(request);
  const deleted = await api.projects.deleteIndirectPool({ id: poolId });

  // A pool with rates or burden is refused: the message says what to do.
  return respond(request, deleted).redirect(path.to.indirectPools, {
    message: "Pool deleted"
  });
}

export default function DeleteIndirectPoolRoute() {
  const { poolId } = useParams();
  const { pool } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!poolId) throw new Error("Pool ID was not found");

  const name = pool.name;
  return (
    <ConfirmDelete
      action={path.to.deleteIndirectPool(poolId)}
      name={name}
      text={t`Are you sure you want to delete the pool: ${name}? This cannot be undone.`}
      onCancel={() => navigate(path.to.indirectPools)}
    />
  );
}
