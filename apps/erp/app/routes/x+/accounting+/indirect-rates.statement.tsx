// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import {
  getIndirectExpenseStatement,
  getIndirectPools,
  getIndirectRates
} from "@carbon/ee/indirect-rates.server";
import { getLogger } from "@carbon/logger";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  HStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { Select } from "~/components";
import { useUrlParams } from "~/hooks";
import { getCurrentFiscalYear } from "~/modules/accounting/accounting.service";
import { IndirectExpenseStatement } from "~/modules/accounting/ui/IndirectRates";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "indirect-rates-statement");

export const handle: Handle = {
  breadcrumb: msg`Statement`
};

const PERIODS = Array.from({ length: 12 }, (_, i) => i + 1);

function parseInteger(raw: string | null, min: number, max: number) {
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/**
 * The Statement of Indirect Expenses of one period (`?fiscalYear&periodNumber`;
 * with no year, the current fiscal year).
 * With no period it opens on the last period of the year with Actual rates.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const searchParams = new URL(request.url).searchParams;
  // A missing or bad `?fiscalYear` opens the current fiscal year, as the
  // Indirect Rates page does.
  const fiscalYear =
    parseInteger(searchParams.get("fiscalYear"), 1900, 9999) ??
    (await getCurrentFiscalYear(client, companyId)).fiscalYear;

  const [pools, rates] = await Promise.all([
    getIndirectPools(client, companyId),
    getIndirectRates(client, { companyId, fiscalYear })
  ]);
  if (pools.error || rates.error) {
    logger.error("Failed to load the indirect rates", {
      companyId,
      fiscalYear,
      error: pools.error ?? rates.error
    });
  }

  const actual = (rates.data ?? []).filter(
    (rate) => rate.rateType === "Actual"
  );
  const lastComputed = actual.reduce(
    (last, rate) => Math.max(last, rate.periodNumber),
    0
  );
  const periodNumber =
    parseInteger(searchParams.get("periodNumber"), 1, 12) ??
    (lastComputed || 12);

  const statement = await getIndirectExpenseStatement(client, {
    companyId,
    fiscalYear,
    periodNumber
  });
  if (statement.error) {
    logger.error("Failed to load the statement of indirect expenses", {
      companyId,
      fiscalYear,
      periodNumber,
      error: statement.error
    });
  }

  return {
    fiscalYear,
    periodNumber,
    pools: pools.data ?? [],
    lines: statement.data ?? [],
    actualRates: actual.filter((rate) => rate.periodNumber === periodNumber)
  };
}

export default function IndirectRatesStatementRoute() {
  const { fiscalYear, periodNumber, pools, lines, actualRates } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const navigate = useNavigate();
  const [, setParams] = useUrlParams();
  const onClose = () =>
    navigate(`${path.to.indirectRates}?fiscalYear=${fiscalYear}`);

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent size="xl">
        <DrawerHeader>
          <HStack className="w-full justify-between gap-2 pr-8">
            <DrawerTitle>
              <Trans>Statement of Indirect Expenses</Trans>
            </DrawerTitle>
            <Select
              aria-label={t`Period`}
              size="sm"
              value={String(periodNumber)}
              options={PERIODS.map((period) => ({
                label: t`FY${fiscalYear} P${period}`,
                value: String(period)
              }))}
              onChange={(value) => setParams({ periodNumber: value })}
            />
          </HStack>
        </DrawerHeader>
        <DrawerBody>
          <IndirectExpenseStatement
            pools={pools}
            lines={lines}
            actualRates={actualRates}
          />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
