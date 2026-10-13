// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { EntitlementError } from "@carbon/ee/entitlements.server";
import {
  deleteIndirectPool,
  getIndirectPool
} from "@carbon/ee/indirect-rates.server";
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
  const { client, companyId } = await requirePermissions(request, {
    delete: "accounting"
  });

  const { poolId } = params;
  if (!poolId) throw notFound("Pool ID was not found");

  let deleted: Awaited<ReturnType<typeof deleteIndirectPool>>;
  try {
    deleted = await deleteIndirectPool(client, { id: poolId, companyId });
  } catch (err) {
    if (!(err instanceof EntitlementError)) throw err;
    logger.error("Indirect rates are not in the company's plan", {
      companyId
    });
    throw redirect(
      path.to.indirectPools,
      await flash(request, error(err, "Upgrade to use indirect rates"))
    );
  }

  if (deleted.error) {
    // A pool with rates or burden is refused: the message says what to do.
    logger.error("Failed to delete an indirect pool", {
      companyId,
      poolId,
      error: deleted.error
    });
    throw redirect(
      path.to.indirectPools,
      await flash(request, error(deleted.error, deleted.error.message))
    );
  }

  throw redirect(
    path.to.indirectPools,
    await flash(request, success("Pool deleted"))
  );
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
