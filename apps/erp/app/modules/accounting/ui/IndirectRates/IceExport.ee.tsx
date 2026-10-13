// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { IceSchedule } from "@carbon/ee/indirect-rates";
import { ICE_SCHEDULES } from "@carbon/ee/indirect-rates";
import { Button } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuDownload } from "react-icons/lu";
import { path } from "~/utils/path";

type IceExportProps = {
  fiscalYear: number;
};

/**
 * The incurred cost electronic (ICE) schedules of one fiscal year, one CSV
 * each. Schedules D, F, J, M, N and O need data outside Carbon.
 */
const IceExport = ({ fiscalYear }: IceExportProps) => {
  const { t } = useLingui();

  const titles: Record<IceSchedule, string> = {
    A: t`Claimed indirect rates: pool, base, rate`,
    B: t`G&A pool by account, unallowable shown`,
    C: t`Overhead pools by account`,
    E: t`Allocation bases by element of cost`,
    G: t`Books reconciled to claimed direct cost`,
    H: t`Direct cost by contract, with indirect cost at claimed rates`,
    I: t`Cumulative cost claimed and billed, by contract`,
    K: t`Hours and amounts on T&M contracts`,
    L: t`Payroll reconciled to labor distribution`
  };

  return (
    <div className="flex w-full flex-col rounded-lg border border-border">
      {ICE_SCHEDULES.map((schedule) => (
        <div
          key={schedule}
          className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
        >
          <span className="w-24 shrink-0 text-sm font-medium">
            <Trans>Schedule {schedule}</Trans>
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {titles[schedule]}
          </span>
          <Button asChild variant="secondary" leftIcon={<LuDownload />}>
            <a
              href={path.to.api.indirectRatesIceCsv(fiscalYear, schedule)}
              download
            >
              <Trans>Download CSV</Trans>
            </a>
          </Button>
        </div>
      ))}
    </div>
  );
};

export default IceExport;
