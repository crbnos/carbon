// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import {
  Heading,
  Input,
  InputGroup,
  InputLeftElement,
  PrefetchLink,
  Subheading
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import type { IconType } from "react-icons";
import {
  LuArrowRightLeft,
  LuCalendarX,
  LuClockAlert,
  LuFileSearch,
  LuFlaskConical,
  LuLandmark,
  LuPin,
  LuReceipt,
  LuSearch,
  LuUsers
} from "react-icons/lu";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction
} from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { PinnedCard, PinToggle } from "~/components/ReportPin";
import { usePermissions } from "~/hooks";
import { reportPinValidator } from "~/modules/accounting/accounting.models";
import { getReportPins } from "~/modules/accounting/accounting.service";
import {
  type ProjectReportKey,
  projectReportPermissions
} from "~/modules/projects/projects.models";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => [{ title: "Carbon | Project Reports" }];

export const handle: Handle = {
  breadcrumb: msg`Reports`,
  to: path.to.projectReports,
  module: "projects"
};

const logger = getLogger("erp", "projects-reports");

// The pins share `reportPin` with the accounting reports, so a project
// report's key is prefixed to keep the two sets apart.
const PIN_PREFIX = "projects:";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "projects",
    role: "employee"
  });

  const pins = await getReportPins(client, userId, companyId);
  if (pins.error) {
    logger.error("Failed to load the report pins", {
      companyId,
      userId,
      error: pins.error
    });
  }

  return {
    pinned: (pins.data ?? []).flatMap((pin) =>
      pin.pinned && pin.reportKey.startsWith(PIN_PREFIX)
        ? [pin.reportKey.slice(PIN_PREFIX.length)]
        : []
    )
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  // The role gate the loader has; the pin itself is the operation's.
  await requirePermissions(request, { view: "projects", role: "employee" });

  const validation = await validator(reportPinValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const { reportKey, pinned } = validation.data;
  const api = await carbon(request);
  const result = await api.projects.upsertProjectReportPin({
    reportKey,
    pinned: pinned === "true"
  });
  if (result.error) {
    return data({}, await flash(request, error(null, result.error.message)));
  }

  return {};
}

type ReportDefinition = {
  key: ProjectReportKey;
  name: string;
  description: string;
  icon: IconType;
  category: string;
};

export default function ProjectReportsRoute() {
  const { pinned } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const permissions = usePermissions();
  const [search, setSearch] = useState("");
  const pinFetcher = useFetcher<typeof action>();

  const reports = useMemo<ReportDefinition[]>(
    () => [
      {
        key: "late-entries",
        name: t`Late Entries`,
        description: t`Time entered after the entry window, with the reason given`,
        icon: LuClockAlert,
        category: t`Timekeeping`
      },
      {
        key: "missing-time",
        name: t`Missing Time`,
        description: t`Scheduled work days with no time entered, with each manager`,
        icon: LuCalendarX,
        category: t`Timekeeping`
      },
      {
        key: "labor-distribution",
        name: t`Labor Distribution`,
        description: t`Hours and dollars by employee and charge number, reconciled to payroll`,
        icon: LuUsers,
        category: t`Timekeeping`
      },
      {
        key: "labor-transfers",
        name: t`Labor Transfers`,
        description: t`Time moved between charge numbers, with the reason and approver`,
        icon: LuArrowRightLeft,
        category: t`Audit and Contracts`
      },
      {
        key: "timesheet-audit",
        name: t`Timesheet Audit`,
        description: t`Every entry in the range and every change made to it`,
        icon: LuFileSearch,
        category: t`Audit and Contracts`
      },
      {
        key: "cost-by-clin",
        name: t`Cost by CLIN`,
        description: t`Allowable and unallowable cost of each contract line, with funding and billing`,
        icon: LuReceipt,
        category: t`Audit and Contracts`
      },
      {
        key: "rd-section-174a",
        name: t`§174A R&E`,
        description: t`Research cost of each business component, domestic and foreign`,
        icon: LuFlaskConical,
        category: t`R&D Tax`
      },
      {
        key: "rd-form-6765-g",
        name: t`Form 6765 Section G`,
        description: t`Qualified research expenses of each business component`,
        icon: LuLandmark,
        category: t`R&D Tax`
      }
    ],
    [t]
  );

  const visibleReports = useMemo(
    () =>
      reports.filter((report) =>
        projectReportPermissions[report.key].view.every((module) =>
          permissions.can("view", module)
        )
      ),
    [reports, permissions]
  );

  const categories = useMemo(() => {
    const lower = search.trim().toLowerCase();
    const result = new Map<string, ReportDefinition[]>();
    for (const report of visibleReports) {
      const matches =
        !lower ||
        report.name.toLowerCase().includes(lower) ||
        report.description.toLowerCase().includes(lower);
      if (!matches) continue;
      const list = result.get(report.category) ?? [];
      list.push(report);
      result.set(report.category, list);
    }
    return [...result.entries()];
  }, [visibleReports, search]);

  // The saved pins, with the toggle in flight applied first.
  const isPinned = (report: ReportDefinition) => {
    if (pinFetcher.formData?.get("reportKey") === report.key) {
      return pinFetcher.formData.get("pinned") === "true";
    }
    return pinned.includes(report.key);
  };

  const togglePin = (report: ReportDefinition, next: boolean) => {
    pinFetcher.submit(
      { reportKey: report.key, pinned: String(next) },
      { method: "post", action: path.to.projectReports }
    );
  };

  const pinnedReports = visibleReports.filter(isPinned);

  return (
    <div className="h-[calc(100dvh-var(--header-height))] w-full overflow-y-auto bg-card">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-8 max-md:gap-6 max-md:p-4">
        {/* Phones: the app bar already titles the page. */}
        <div className="flex items-center justify-between gap-4 max-md:[&>h1]:hidden">
          <Heading as="h1" size="h1">
            <Trans>Reports</Trans>
          </Heading>
          <InputGroup size="sm" className="w-64 max-md:w-full">
            <InputLeftElement>
              <LuSearch className="h-4 w-4 text-muted-foreground" />
            </InputLeftElement>
            <Input
              placeholder={t`Search`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </InputGroup>
        </div>

        {pinnedReports.length > 0 && (
          <div>
            <Subheading className="mb-3 flex items-center gap-1.5">
              <LuPin className="h-3 w-3" />
              <Trans>Pinned</Trans>
            </Subheading>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {pinnedReports.map((report) => (
                <PinnedCard
                  key={report.key}
                  to={path.to.projectReport(report.key)}
                  icon={report.icon}
                  name={report.name}
                  pinned
                  onToggle={(next) => togglePin(report, next)}
                  pinLabel={t`Pin ${report.name}`}
                  unpinLabel={t`Unpin ${report.name}`}
                />
              ))}
            </div>
          </div>
        )}

        {categories.map(([category, categoryReports]) => (
          <div key={category}>
            <Subheading className="mb-3 flex items-center gap-1.5">
              {category}
            </Subheading>
            <div className="overflow-hidden rounded-lg border border-border">
              {categoryReports.map((report, index) => (
                <PrefetchLink
                  key={report.key}
                  to={path.to.projectReport(report.key)}
                  className={
                    "flex cursor-pointer items-center gap-3 bg-card/70 px-4 py-2.5 transition-colors hover:bg-accent/40" +
                    (index > 0 ? " border-t border-border" : "")
                  }
                >
                  <report.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm font-medium max-md:shrink-0 max-md:whitespace-nowrap">
                    {report.name}
                  </span>
                  <span className="truncate text-sm text-muted-foreground">
                    {report.description}
                  </span>
                  <span className="ml-auto">
                    <PinToggle
                      pinned={isPinned(report)}
                      onToggle={(next) => togglePin(report, next)}
                      pinLabel={t`Pin ${report.name}`}
                      unpinLabel={t`Unpin ${report.name}`}
                    />
                  </span>
                </PrefetchLink>
              ))}
            </div>
          </div>
        ))}

        {categories.length === 0 && (
          <p className="text-sm text-muted-foreground">
            <Trans>No reports match your search.</Trans>
          </p>
        )}
      </div>
    </div>
  );
}
