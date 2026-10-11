// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  DateRangePicker,
  Heading,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Subheading
} from "@carbon/react";
import { formatPeriodLabel } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { DateRange } from "@react-types/datepicker";
import { type ReactNode, useState } from "react";
import { LuDownload } from "react-icons/lu";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { useCompanyToday, usePermissions } from "~/hooks";
import {
  getLaborDistributionPeriods,
  type ProjectReportKey
} from "~/modules/projects";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "projects-reports");

export const meta: MetaFunction = () => [{ title: "Carbon | Project Reports" }];

export const handle: Handle = {
  breadcrumb: msg`Reports`,
  to: path.to.projectReports,
  module: "projects"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "projects",
    role: "employee"
  });

  try {
    return {
      periods: await getLaborDistributionPeriods(getDatabaseClient(), {
        companyId
      })
    };
  } catch (error) {
    logger.error("Failed to load the accounting periods", {
      companyId,
      error
    });
    return { periods: [] };
  }
}

type Permission = { view: string[] };

type ReportCardDefinition = {
  key: ProjectReportKey;
  name: string;
  description: string;
  /** Labor distribution runs for one accounting period, the rest a range. */
  input: "range" | "period";
  permission: Permission;
};

export default function ProjectReportsRoute() {
  const { periods } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const permissions = usePermissions();

  const timekeeping: ReportCardDefinition[] = [
    {
      key: "late-entries",
      name: t`Late entries`,
      description: t`Time entered after the entry window, with the reason the employee gave`,
      input: "range",
      permission: { view: ["projects"] }
    },
    {
      key: "missing-time",
      name: t`Missing time`,
      description: t`Scheduled work days with no time entered, with each employee's manager`,
      input: "range",
      permission: { view: ["projects"] }
    },
    {
      key: "labor-distribution",
      name: t`Labor distribution`,
      description: t`Hours and dollars by employee and charge number, reconciled to timecards and payroll`,
      input: "period",
      permission: { view: ["projects", "people"] }
    }
  ];
  const audit: ReportCardDefinition[] = [
    {
      key: "labor-transfers",
      name: t`Labor transfers`,
      description: t`Time moved between charge numbers, with the reason, the requester and the approver`,
      input: "range",
      permission: { view: ["projects"] }
    },
    {
      key: "timesheet-audit",
      name: t`Timesheet export for auditors`,
      description: t`Every entry dated in the range and every change made to it`,
      input: "range",
      permission: { view: ["projects"] }
    },
    {
      key: "cost-by-clin",
      name: t`Cost by CLIN`,
      description: t`Allowable and unallowable cost of each contract line item, with its funding and billing`,
      input: "range",
      permission: { view: ["sales"] }
    }
  ];

  const canSee = (report: ReportCardDefinition) =>
    report.permission.view.every((module) => permissions.can("view", module));

  const sections = [
    { name: t`Timekeeping`, reports: timekeeping.filter(canSee) },
    { name: t`Audit and contracts`, reports: audit.filter(canSee) }
  ].filter((section) => section.reports.length > 0);

  return (
    <div className="h-[calc(100dvh-var(--header-height))] w-full overflow-y-auto bg-card">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-8 max-md:gap-6 max-md:p-4">
        {/* Phones: the app bar already titles the page. */}
        <Heading as="h1" size="h1" className="max-md:hidden">
          <Trans>Reports</Trans>
        </Heading>
        {sections.map((section) => (
          <div key={section.name}>
            <Subheading className="mb-3">{section.name}</Subheading>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {section.reports.map((report) =>
                report.input === "period" ? (
                  <PeriodReportCard
                    key={report.key}
                    report={report}
                    periods={periods}
                  />
                ) : (
                  <RangeReportCard key={report.key} report={report} />
                )
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportCard({
  report,
  href,
  children
}: {
  report: ReportCardDefinition;
  href: string | null;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>{report.name}</CardTitle>
        <CardDescription>{report.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">{children}</CardContent>
      <CardFooter>
        {href ? (
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<LuDownload />}
            asChild
          >
            <a href={href} download>
              <Trans>Download CSV</Trans>
            </a>
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<LuDownload />}
            isDisabled
          >
            <Trans>Download CSV</Trans>
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

/** A report over a date range. It opens on the current month to date. */
function RangeReportCard({ report }: { report: ReportCardDefinition }) {
  const today = parseDate(useCompanyToday());
  // Only the user's pick is state; until then the range is the default.
  const [chosenRange, setChosenRange] = useState<DateRange | null>();
  const range =
    chosenRange === undefined
      ? { start: today.set({ day: 1 }), end: today }
      : chosenRange;

  const href = range
    ? path.to.api.projectReport(report.key, {
        from: range.start.toString(),
        to: range.end.toString()
      })
    : null;

  return (
    <ReportCard report={report} href={href}>
      <DateRangePicker size="sm" value={range} onChange={setChosenRange} />
    </ReportCard>
  );
}

/** A report for one accounting period. It opens on the latest period that
 *  has started. */
function PeriodReportCard({
  report,
  periods
}: {
  report: ReportCardDefinition;
  periods: { id: string; startDate: string; endDate: string }[];
}) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const today = useCompanyToday();
  const [chosenPeriodId, setChosenPeriodId] = useState<string | null>(null);
  const periodId =
    chosenPeriodId ??
    periods.find((period) => period.startDate <= today)?.id ??
    periods[0]?.id ??
    null;

  return (
    <ReportCard
      report={report}
      href={
        periodId ? path.to.api.projectReport(report.key, { periodId }) : null
      }
    >
      {periods.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Trans>No accounting periods yet</Trans>
        </p>
      ) : (
        <Select value={periodId ?? undefined} onValueChange={setChosenPeriodId}>
          <SelectTrigger size="sm" aria-label={t`Accounting period`}>
            <SelectValue placeholder={t`Choose a period`} />
          </SelectTrigger>
          <SelectContent>
            {periods.map((period) => (
              <SelectItem key={period.id} value={period.id}>
                {formatPeriodLabel(period.startDate, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </ReportCard>
  );
}
