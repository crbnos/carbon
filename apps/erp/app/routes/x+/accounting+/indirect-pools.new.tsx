// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { indirectPoolValidator } from "@carbon/ee/indirect-rates";
import { requireFeature } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { IndirectPoolForm } from "~/modules/accounting/ui/IndirectRates";
import { path } from "~/utils/path";

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

  const validation = await validator(indirectPoolValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const { id: _id, ...fields } = validation.data;
  const api = await carbon(request);
  const created = await api.projects.upsertIndirectPool(fields);

  if (created.error) {
    if (created.error.category === "entitlement") {
      throw redirect(
        path.to.indirectPools,
        await flash(request, error(null, created.error.message))
      );
    }
    // A duplicate name or sequence: the op's message is the field's.
    if (created.error.category === "conflict") {
      return validationError({
        fieldErrors: {
          [created.error.message.includes("sequence") ? "sequence" : "name"]:
            created.error.message
        }
      });
    }
    return data(
      {},
      await flash(request, error(null, "Failed to create the pool"))
    );
  }

  if (!created.data) {
    return data(
      {},
      await flash(request, error(null, "Failed to create the pool"))
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
