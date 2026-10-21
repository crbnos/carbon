// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { EntitlementError } from "@carbon/ee/entitlements.server";
import {
  indirectPoolAccountValidator,
  indirectPoolValidator,
  indirectRatesFieldErrors
} from "@carbon/ee/indirect-rates";
import {
  deleteIndirectPoolAccount,
  getIndirectPool,
  INDIRECT_POOL_BASE_PROJECT_ACCOUNT,
  upsertIndirectPool,
  upsertIndirectPoolAccount
} from "@carbon/ee/indirect-rates.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { usePermissions } from "~/hooks";
import { getActiveDimensionsWithValues } from "~/modules/accounting/accounting.service";
import type { IndirectPoolAccountRow } from "~/modules/accounting/ui/IndirectRates";
import {
  IndirectPoolAccounts,
  IndirectPoolForm
} from "~/modules/accounting/ui/IndirectRates";
import type { DimensionWithValues } from "~/modules/accounting/ui/JournalEntries/types";
import { path } from "~/utils/path";

const logger = getLogger("erp", "indirect-pool");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    { view: "accounting", role: "employee" }
  );

  const { poolId } = params;
  if (!poolId) throw notFound("Pool ID was not found");

  const [pool, dimensions] = await Promise.all([
    getIndirectPool(client, poolId, companyId),
    getActiveDimensionsWithValues(client, companyGroupId, companyId)
  ]);

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
  if (dimensions.error) {
    logger.error("Failed to load the dimensions", {
      companyId,
      error: dimensions.error
    });
  }

  return {
    pool: pool.data,
    dimensions: (dimensions.data ?? []) as DimensionWithValues[]
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { poolId } = params;
  if (!poolId) throw notFound("Pool ID was not found");

  await requireFeature({
    request,
    client,
    companyId,
    feature: "GOVERNMENT_CONTRACTING",
    redirectTo: path.to.indirectPools
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  const refuse = async (err: unknown, message: string) =>
    data({ success: false }, await flash(request, error(err, message)));
  const done = async (message: string) =>
    data({ success: true }, await flash(request, success(message)));

  try {
    if (intent === "account-add") {
      const validation = await validator(indirectPoolAccountValidator).validate(
        formData
      );
      if (validation.error) return validationError(validation.error);
      if (validation.data.indirectPoolId !== poolId) {
        return refuse(null, "The account is not for this pool");
      }
      const result = await upsertIndirectPoolAccount(client, {
        ...validation.data,
        companyId,
        userId
      });
      if (result.error) {
        // B2: a project account cannot be a Base account.
        if (result.error.message === INDIRECT_POOL_BASE_PROJECT_ACCOUNT) {
          return validationError({
            fieldErrors: { accountId: INDIRECT_POOL_BASE_PROJECT_ACCOUNT }
          });
        }
        const fieldErrors = indirectRatesFieldErrors(result.error);
        if (fieldErrors) return validationError({ fieldErrors });
        logger.error("Failed to add an indirect pool account", {
          companyId,
          poolId,
          error: result.error
        });
        return refuse(result.error, "Failed to add the account");
      }
      return done("Account added");
    }

    if (intent === "account-delete") {
      const id = formData.get("id");
      if (typeof id !== "string") return refuse(null, "No account was given");
      const result = await deleteIndirectPoolAccount(client, {
        id,
        companyId
      });
      if (result.error) {
        logger.error("Failed to remove an indirect pool account", {
          companyId,
          poolId,
          id,
          error: result.error
        });
        return refuse(result.error, "Failed to remove the account");
      }
      return done("Account removed");
    }

    const validation = await validator(indirectPoolValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);

    const { id: _id, ...fields } = validation.data;
    const updated = await upsertIndirectPool(client, {
      ...fields,
      id: poolId,
      companyId,
      userId
    });
    if (updated.error) {
      const fieldErrors = indirectRatesFieldErrors(updated.error);
      if (fieldErrors) return validationError({ fieldErrors });
      logger.error("Failed to update an indirect pool", {
        companyId,
        poolId,
        error: updated.error
      });
      return data(
        {},
        await flash(request, error(updated.error, "Failed to update the pool"))
      );
    }
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

  throw redirect(
    path.to.indirectPools,
    await flash(request, success("Pool updated"))
  );
}

export default function IndirectPoolRoute() {
  const { pool, dimensions } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();
  const permissions = usePermissions();

  return (
    <IndirectPoolForm
      key={pool.id}
      initialValues={{
        id: pool.id,
        name: pool.name,
        poolType: pool.poolType,
        sequence: pool.sequence,
        baseType: pool.baseType,
        appliedAccountId: pool.appliedAccountId ?? "",
        appliesToProjects: pool.appliesToProjects,
        offsetAbsorbedOverhead: pool.offsetAbsorbedOverhead,
        active: pool.active
      }}
      onClose={() => closeRoute()}
    >
      <IndirectPoolAccounts
        poolId={pool.id}
        accounts={pool.accounts as IndirectPoolAccountRow[]}
        dimensions={dimensions}
        action={path.to.indirectPool(pool.id)}
        isDisabled={!permissions.can("update", "accounting")}
      />
    </IndirectPoolForm>
  );
}
