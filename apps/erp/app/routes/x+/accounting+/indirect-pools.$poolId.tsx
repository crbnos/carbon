// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  indirectPoolAccountValidator,
  indirectPoolValidator
} from "@carbon/ee/indirect-rates";
import {
  getIndirectPool,
  INDIRECT_POOL_BASE_PROJECT_ACCOUNT
} from "@carbon/ee/indirect-rates.server";
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

  const { poolId } = params;
  if (!poolId) throw notFound("Pool ID was not found");

  const formData = await request.formData();
  const intent = formData.get("intent");

  const refuse = async (message: string) =>
    data({ success: false }, await flash(request, error(null, message)));
  const done = async (message: string) =>
    data({ success: true }, await flash(request, success(message)));
  const upgrade = async (message: string) => {
    throw redirect(
      path.to.indirectPools,
      await flash(request, error(null, message))
    );
  };

  const api = await carbon(request);

  if (intent === "account-add") {
    const validation = await validator(indirectPoolAccountValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);
    if (validation.data.indirectPoolId !== poolId) {
      return refuse("The account is not for this pool");
    }
    const result = await api.projects.upsertIndirectPoolAccount(
      validation.data
    );
    if (result.error) {
      if (result.error.category === "entitlement") {
        return upgrade(result.error.message);
      }
      // B2: a project account cannot be a Base account; a duplicate cell is
      // refused on the account too.
      if (
        result.error.category === "conflict" ||
        result.error.message === INDIRECT_POOL_BASE_PROJECT_ACCOUNT
      ) {
        return validationError({
          fieldErrors: { accountId: result.error.message }
        });
      }
      return refuse("Failed to add the account");
    }
    return done("Account added");
  }

  if (intent === "account-delete") {
    const id = formData.get("id");
    if (typeof id !== "string") return refuse("No account was given");
    const result = await api.projects.deleteIndirectPoolAccount({ id });
    if (result.error) {
      if (result.error.category === "entitlement") {
        return upgrade(result.error.message);
      }
      return refuse("Failed to remove the account");
    }
    return done("Account removed");
  }

  const validation = await validator(indirectPoolValidator).validate(formData);
  if (validation.error) return validationError(validation.error);

  const updated = await api.projects.upsertIndirectPool({
    ...validation.data,
    id: poolId
  });
  if (updated.error) {
    if (updated.error.category === "entitlement") {
      return upgrade(updated.error.message);
    }
    // A duplicate name or sequence: the op's message is the field's.
    if (updated.error.category === "conflict") {
      return validationError({
        fieldErrors: {
          [updated.error.message.includes("sequence") ? "sequence" : "name"]:
            updated.error.message
        }
      });
    }
    return data(
      {},
      await flash(request, error(null, "Failed to update the pool"))
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
