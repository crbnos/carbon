// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { respond } from "@carbon/api/carbon.server";
import { assertIsPost, error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import {
  datetime,
  fiscalYearAndPeriodFor,
  formatDate,
  redirect
} from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { generateFiscalYearPeriodsValidator } from "~/modules/accounting/accounting.models";
import { getFiscalStartMonth } from "~/modules/accounting/accounting.service";
import { getCompanyTimeZone } from "~/modules/shared/shared.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Generate Fiscal Year`,
  to: path.to.accountingPeriods
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await authorize(request, {
    "accounting.accountingPeriods": "View"
  });

  // The month the preview shows the range from. The form sends it back, and
  // the action refuses when the settings changed since.
  const fiscalStart = await getFiscalStartMonth(companyId);
  if (fiscalStart.error) {
    throw redirect(
      path.to.accountingPeriods,
      await flash(
        request,
        error(fiscalStart.error, "Failed to load the fiscal year settings", {
          companyId
        })
      )
    );
  }
  const startMonth = fiscalStart.data;
  const companyToday = datetime.today(
    await getCompanyTimeZone(client, companyId)
  );
  const defaultFiscalYear = fiscalYearAndPeriodFor(
    companyToday.year,
    companyToday.month,
    startMonth
  ).fiscalYear;

  return { startMonth, defaultFiscalYear };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { api } = await authorize(request, {
    "accounting.accountingPeriods": "Create"
  });

  const formData = await request.formData();
  const validation = await validator(
    generateFiscalYearPeriodsValidator
  ).validate(formData);
  if (validation.error) return validationError(validation.error);

  const result = await api.accounting.createFiscalYearPeriods({
    fiscalYear: validation.data.fiscalYear,
    startMonth: validation.data.startMonth
  });

  // It only inserts the periods that did not exist, so `ids` are the newly
  // created ones (none = year already complete).
  const created = result.data?.ids.length ?? 0;
  return respond(request, result).redirect(path.to.accountingPeriods, {
    message:
      created === 0
        ? "All periods for that fiscal year already exist"
        : `Generated ${created} accounting ${
            created === 1 ? "period" : "periods"
          }`
  });
}

// Given a fiscal year + the company's fiscal start month, the period range spans
// 12 months starting at that month. FY is named by its ending calendar year, so a
// non-January start begins in the prior calendar year (mirrors the service).
function fiscalYearRange(fiscalYear: number, startMonth: number) {
  const firstYear = startMonth === 1 ? fiscalYear : fiscalYear - 1;
  const start = new Date(Date.UTC(firstYear, startMonth - 1, 1));
  const end = new Date(Date.UTC(firstYear, startMonth - 1 + 12, 0));
  const fmt = (d: Date) =>
    formatDate(d.toISOString().split("T")[0], {
      month: "short",
      year: "numeric"
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

export default function GenerateFiscalYearRoute() {
  const { startMonth, defaultFiscalYear } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();
  const [year, setYear] = useState(defaultFiscalYear);

  const isValidYear = Number.isInteger(year) && year >= 2000 && year <= 2200;
  const preview = isValidYear ? fiscalYearRange(year, startMonth) : null;
  const isBusy = fetcher.state !== "idle";

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) navigate(path.to.accountingPeriods);
      }}
    >
      <ModalContent size="small">
        <fetcher.Form method="post" action={path.to.accountingPeriodsGenerate}>
          <ModalHeader>
            <ModalTitle>
              <Trans>Generate fiscal year</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Creates the 12 monthly periods for a fiscal year. Periods that
                already exist are kept.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <input type="hidden" name="intent" value="generate" />
            <input type="hidden" name="startMonth" value={startMonth} />
            <VStack spacing={2}>
              <div className="w-full">
                <label
                  htmlFor="fiscalYear"
                  className="text-sm font-medium block mb-1.5"
                >
                  <Trans>Fiscal year</Trans>
                </label>
                <Input
                  id="fiscalYear"
                  name="fiscalYear"
                  type="number"
                  min={2000}
                  max={2200}
                  value={Number.isNaN(year) ? "" : String(year)}
                  onChange={(e) => setYear(e.target.valueAsNumber)}
                />
              </div>
              {preview && (
                <p className="text-sm text-muted-foreground">
                  {preview} · {t`12 monthly periods`}
                </p>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button type="submit" isLoading={isBusy} isDisabled={!isValidYear}>
              <Trans>Generate</Trans>
            </Button>
          </ModalFooter>
        </fetcher.Form>
      </ModalContent>
    </Modal>
  );
}
