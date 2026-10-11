// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { EntitlementError } from "@carbon/ee/entitlements.server";
import {
  indirectPoolValidator,
  indirectRatesFieldErrors
} from "@carbon/ee/indirect-rates";
import { upsertIndirectPool } from "@carbon/ee/indirect-rates.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { IndirectPoolForm } from "~/modules/accounting/ui/IndirectRates";
import { path } from "~/utils/path";

const logger = getLogger("erp", "indirect-pool-new");

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "accounting"
  });

  await requireFeature({
    request,
    client,
    companyId,
    feature: "GOVERNMENT_CONTRACTING",
    redirectTo: path.to.indirectPools
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  await requireFeature({
    request,
    client,
    companyId,
    feature: "GOVERNMENT_CONTRACTING",
    redirectTo: path.to.indirectPools
  });

  const validation = await validator(indirectPoolValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const { id: _id, ...fields } = validation.data;
  let created: Awaited<ReturnType<typeof upsertIndirectPool>>;
  try {
    created = await upsertIndirectPool(client, {
      ...fields,
      companyId,
      userId
    });
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

  if (created.error) {
    const fieldErrors = indirectRatesFieldErrors(created.error);
    if (fieldErrors) return validationError({ fieldErrors });
    logger.error("Failed to create an indirect pool", {
      companyId,
      error: created.error
    });
    return data(
      {},
      await flash(request, error(created.error, "Failed to create the pool"))
    );
  }

  throw redirect(
    path.to.indirectPool(created.data.id),
    await flash(request, success("Pool created"))
  );
}

export default function NewIndirectPoolRoute() {
  const closeRoute = useCloseRoute();
  return (
    <IndirectPoolForm
      initialValues={{
        name: "",
        poolType: "Overhead",
        sequence: 1,
        baseType: "Direct Labor Dollars",
        appliedAccountId: "",
        appliesToProjects: true,
        offsetAbsorbedOverhead: false,
        active: true
      }}
      onClose={() => closeRoute()}
    />
  );
}
