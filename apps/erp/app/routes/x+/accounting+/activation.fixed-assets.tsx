// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  getCutoverFixedAssets,
  updateCutoverAccumulatedDepreciation
} from "@carbon/database/accounting-cutover-reads";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { getErrorMessage, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { SetupBody, SetupSection } from "~/components/Setup";
import { cutoverAccumulatedDepreciationValidator } from "~/modules/accounting";
import { getActivationCutover } from "~/modules/accounting/accounting.server";
import {
  ActivationFooter,
  FixedAssetDepreciationTable
} from "~/modules/accounting/ui/Activation";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "accounting/activation/fixed-assets");

export const handle: Handle = {
  breadcrumb: msg`Fixed Assets`,
  to: path.to.accountingActivationStep("fixed-assets")
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });
  const { cutoverDate } = await getActivationCutover(
    client,
    companyId,
    request
  );
  const assets = await getCutoverFixedAssets(getDatabaseClient(), {
    companyId,
    cutoverDate
  });
  return { cutoverDate, assets };
}

/** `save-asset`: one asset's accumulated depreciation at the cutover. */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent !== "save-asset") {
    return data(
      {},
      await flash(request, error(intent, "Unknown fixed asset action"))
    );
  }

  const validation = await validator(
    cutoverAccumulatedDepreciationValidator
  ).validate(formData);
  if (validation.error) {
    return data(
      {},
      await flash(
        request,
        error(
          validation.error,
          Object.values(validation.error.fieldErrors)[0] ??
            "Invalid accumulated depreciation"
        )
      )
    );
  }

  try {
    const { cutoverDate } = await getActivationCutover(
      client,
      companyId,
      request
    );
    await updateCutoverAccumulatedDepreciation(getDatabaseClient(), {
      companyId,
      cutoverDate,
      userId,
      fixedAssetId: validation.data.fixedAssetId,
      accumulatedDepreciation: validation.data.accumulatedDepreciation
    });
  } catch (err) {
    logger.error("Failed to save the accumulated depreciation", {
      companyId,
      fixedAssetId: validation.data.fixedAssetId,
      error: err
    });
    return data(
      {},
      await flash(
        request,
        error(
          err,
          getErrorMessage(err, "Failed to save the accumulated depreciation")
        )
      )
    );
  }

  const { pathname, search } = new URL(request.url);
  throw redirect(`${pathname}${search}`);
}

/** Step 3: each asset's cost and accumulated depreciation at the cutover. */
export default function AccountingActivationFixedAssetsRoute() {
  const { cutoverDate, assets } = useLoaderData<typeof loader>();

  return (
    <>
      <SetupBody>
        <SetupSection
          title={<Trans>Fixed Assets</Trans>}
          description={
            <Trans>
              No depreciation run happens before the cutover. Enter each asset's
              accumulated depreciation as of the cutover date.
            </Trans>
          }
        >
          <FixedAssetDepreciationTable
            assets={assets}
            cutoverDate={cutoverDate}
          />
        </SetupSection>
      </SetupBody>
      <ActivationFooter step="fixed-assets" cutoverDate={cutoverDate} />
    </>
  );
}
