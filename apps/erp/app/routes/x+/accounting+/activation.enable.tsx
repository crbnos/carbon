// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ValidatedForm, validator } from "@carbon/form";
import { Alert, AlertDescription, AlertTitle } from "@carbon/react";
import { serverFns } from "@carbon/server-functions";
import { getErrorMessage, redirect } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Link, useLoaderData } from "react-router";
import { Hidden, Input, Submit } from "~/components/Form";
import { SetupBody, SetupSection } from "~/components/Setup";
import {
  useCurrencyFormatter,
  useDateFormatter,
  usePermissions,
  useUser
} from "~/hooks";
import { activateAccountingValidator } from "~/modules/accounting";
import {
  getActivationCutover,
  getActivationReadiness,
  getMigrationClearing
} from "~/modules/accounting/accounting.server";
import {
  ActivationFooter,
  activationStepPath,
  isMigrationClearingZero
} from "~/modules/accounting/ui/Activation";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Enable`,
  to: path.to.accountingActivationStep("enable")
};

/** Opening items that are documents, not the inventory and asset totals. */
const AGGREGATE_ITEM_TYPES = new Set([
  "Inventory",
  "Fixed Asset Cost",
  "Accumulated Depreciation"
]);

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });
  const { cutoverDate } = await getActivationCutover(
    client,
    companyId,
    request
  );
  const db = getDatabaseClient();
  const [readiness, clearing] = await Promise.all([
    getActivationReadiness(db, { companyId, cutoverDate }),
    getMigrationClearing(db, { companyId, cutoverDate })
  ]);
  return {
    cutoverDate,
    readinessPassed: readiness.passed,
    openItemCount: clearing.items.filter(
      (item) => !AGGREGATE_ITEM_TYPES.has(item.openItemType)
    ).length,
    migrationClearingTotal: clearing.total
  };
}

/** Runs the one-way enable through the `activate-accounting` server function. */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(activateAccountingValidator).validate(
    formData
  );
  if (validation.error) {
    return data(
      {},
      await flash(
        request,
        error(
          validation.error,
          Object.values(validation.error.fieldErrors)[0] ??
            "Type the company name to confirm"
        )
      )
    );
  }

  const result = await serverFns
    .as({ client, db: getDatabaseClient(), companyId, userId })
    .invoke("activate-accounting", {
      cutoverDate: validation.data.cutoverDate,
      confirmation: validation.data.confirmation
    });
  if (result.error) {
    return data(
      {},
      await flash(
        request,
        error(
          result.error,
          getErrorMessage(result.error, "Failed to enable accounting")
        )
      )
    );
  }

  throw redirect(
    path.to.accountingPeriods,
    await flash(request, success("Accounting is enabled"))
  );
}

/** Step 5: what the enable will do, and the one-way confirmation. */
export default function AccountingActivationEnableRoute() {
  const { t } = useLingui();
  const {
    cutoverDate,
    readinessPassed,
    openItemCount,
    migrationClearingTotal
  } = useLoaderData<typeof loader>();
  const { company } = useUser();
  const permissions = usePermissions();
  const formatter = useCurrencyFormatter();
  const { formatDate } = useDateFormatter();

  const isClearingZero = isMigrationClearingZero(migrationClearingTotal);
  const canEnable =
    readinessPassed &&
    isClearingZero &&
    permissions.can("update", "accounting");

  return (
    <>
      <SetupBody>
        <SetupSection title={<Trans>Summary</Trans>}>
          <dl className="grid w-full max-w-xl grid-cols-[auto_1fr] gap-x-8 gap-y-3 text-sm">
            <dt className="text-muted-foreground">
              <Trans>Cutover date</Trans>
            </dt>
            <dd>{formatDate(cutoverDate)}</dd>
            <dt className="text-muted-foreground">
              <Trans>Opening balances as of</Trans>
            </dt>
            <dd>
              {formatDate(
                parseDate(cutoverDate).subtract({ days: 1 }).toString()
              )}
            </dd>
            <dt className="text-muted-foreground">
              <Trans>Open items</Trans>
            </dt>
            <dd className="tabular-nums">{openItemCount}</dd>
            <dt className="text-muted-foreground">
              <Trans>Migration Clearing</Trans>
            </dt>
            <dd
              className={
                isClearingZero
                  ? "tabular-nums"
                  : "tabular-nums text-destructive"
              }
            >
              {formatter.format(migrationClearingTotal)}
            </dd>
          </dl>
          {!readinessPassed && (
            <p className="text-sm text-destructive">
              <Trans>
                A readiness check fails.{" "}
                <Link
                  to={activationStepPath("readiness", cutoverDate)}
                  className="underline"
                >
                  Go to Readiness
                </Link>
              </Trans>
            </p>
          )}
          {!isClearingZero && (
            <p className="text-sm text-destructive">
              <Trans>
                Migration Clearing must total zero.{" "}
                <Link
                  to={activationStepPath("trial-balance", cutoverDate)}
                  className="underline"
                >
                  Go to Trial balance
                </Link>
              </Trans>
            </p>
          )}
        </SetupSection>

        <SetupSection title={<Trans>Enable Accounting</Trans>}>
          <Alert variant="destructive" className="max-w-xl">
            <LuTriangleAlert className="h-4 w-4" />
            <AlertTitle>
              <Trans>This cannot be undone.</Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans>
                Carbon posts the opening journal, posts every journal dated on
                or after the cutover date, and closes the periods before it.
              </Trans>
            </AlertDescription>
          </Alert>
          <ValidatedForm
            validator={activateAccountingValidator}
            method="post"
            action={activationStepPath("enable", cutoverDate)}
            defaultValues={{ cutoverDate, confirmation: "" }}
            className="flex w-full max-w-xl flex-col gap-4"
          >
            <Hidden name="cutoverDate" />
            <Input
              name="confirmation"
              label={t`Type ${company.name} to confirm`}
              autoComplete="off"
            />
            <div>
              <Submit isDisabled={!canEnable}>
                <Trans>Enable accounting</Trans>
              </Submit>
            </div>
          </ValidatedForm>
        </SetupSection>
      </SetupBody>
      <ActivationFooter step="enable" cutoverDate={cutoverDate} />
    </>
  );
}
