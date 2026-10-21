// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import {
  Badge,
  Button,
  DropdownMenuContent,
  DropdownMenuItem,
  MenuIcon,
  MenuItem
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo } from "react";
import {
  LuBellRing,
  LuBuilding2,
  LuEye,
  LuEyeOff,
  LuMapPin,
  LuUser,
  LuUserCheck,
  LuUserX
} from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Link, useFetcher, useLoaderData } from "react-router";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import {
  missingTimeActionValidator,
  projectReportPermissions
} from "~/modules/projects/projects.models";
import { getProjectReportRange } from "~/modules/projects/projects.server";
import {
  getMissingTimeByEmployee,
  getMissingTimeExcludedCount,
  type MissingTimeEmployee,
  updateTimesheetRequired
} from "~/modules/projects/projects.service";
import {
  NumberCell,
  ProjectReport,
  projectReportHandle,
  ReportRangeSelect,
  useReportFormat
} from "~/modules/projects/ui/Reports/ProjectReport";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle = projectReportHandle("missing-time", msg`Missing Time`);

const logger = getLogger("erp", "projects-missing-time");

/** The columns the report filters on, each an id of `MissingTimeEmployee`. */
const FILTER_KEYS = [
  "employeeId",
  "managerId",
  "departmentId",
  "locationId"
] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

/** How many dates a reminder names before it says "and N more". */
const REMINDER_DATES = 5;

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    ...projectReportPermissions["missing-time"],
    role: "employee"
  });
  const db = getDatabaseClient();
  const params = new URL(request.url).searchParams;
  const excluded = params.get("excluded") === "true";
  const range = await getProjectReportRange(db, request, companyId);
  const [employees, excludedCount] = await Promise.all([
    getMissingTimeByEmployee(db, {
      companyId,
      from: range.startDate,
      to: range.endDate,
      excluded
    }),
    getMissingTimeExcludedCount(db, { companyId })
  ]);

  // The filter options come from every row, so a filter never hides its own
  // choices.
  const options = Object.fromEntries(
    FILTER_KEYS.map((key) => {
      const nameOf = (row: MissingTimeEmployee) =>
        key === "employeeId"
          ? row.employeeName
          : key === "managerId"
            ? row.managerName
            : key === "departmentId"
              ? row.departmentName
              : row.locationName;
      const byId = new Map<string, string>();
      for (const row of employees) {
        const id = row[key];
        if (id) byId.set(id, nameOf(row) ?? id);
      }
      return [
        key,
        [...byId.entries()]
          .map(([value, label]) => ({ value, label }))
          .sort((a, b) => a.label.localeCompare(b.label))
      ];
    })
  ) as Record<FilterKey, { value: string; label: string }[]>;

  const chosen = new Map<FilterKey, string[]>();
  for (const filter of getGenericQueryFilters(params).filters ?? []) {
    if (!(FILTER_KEYS as readonly string[]).includes(filter.column)) continue;
    if (filter.operator !== "eq" && filter.operator !== "in") continue;
    if (!filter.value) continue;
    chosen.set(filter.column as FilterKey, filter.value.split(","));
  }
  const search = params.get("search")?.trim().toLowerCase() ?? "";

  const rows = employees.filter((row) => {
    for (const [key, values] of chosen) {
      if (!values.includes(row[key] ?? "")) return false;
    }
    if (!search) return true;
    return [
      row.employeeName,
      row.managerName,
      row.departmentName,
      row.locationName
    ].some((value) => value?.toLowerCase().includes(search));
  });

  return { ...range, excluded, excludedCount, options, rows };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    ...projectReportPermissions["missing-time"],
    role: "employee"
  });
  const validation = await validator(missingTimeActionValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }
  const db = getDatabaseClient();

  if (validation.data.intent === "remind") {
    const { employeeIds, startDate, endDate } = validation.data;
    // The dates come from the database again, not from the browser.
    const employees = await getMissingTimeByEmployee(db, {
      companyId,
      from: startDate,
      to: endDate,
      excluded: false
    });
    const chosen = employees.filter(
      (employee) =>
        employeeIds.includes(employee.employeeId) && employee.dates.length > 0
    );

    try {
      await Promise.all(
        chosen.map((employee) => {
          const shown = employee.dates
            .slice(0, REMINDER_DATES)
            .map((date) => formatDate(date))
            .join(", ");
          const more = employee.dates.length - REMINDER_DATES;
          return trigger("notify", {
            event: NotificationEvent.TimesheetMissing,
            companyId,
            documentId: employee.dates[employee.dates.length - 1]!,
            recipient: { type: "users", userIds: [employee.employeeId] },
            from: userId,
            body:
              more > 0
                ? `No time entered for ${shown} and ${more} more days`
                : `No time entered for ${shown}`
          });
        })
      );
    } catch (err) {
      logger.error("Failed to send the missing time reminders", {
        companyId,
        employeeIds,
        error: err
      });
      return data(
        {},
        await flash(request, error(err, "Failed to send the reminders"))
      );
    }

    return data(
      {},
      await flash(
        request,
        success(
          chosen.length === 1
            ? "Sent 1 reminder"
            : `Sent ${chosen.length} reminders`
        )
      )
    );
  }

  // Taking a person out of the report changes their job record.
  await requirePermissions(request, { update: "people", role: "employee" });
  const { intent, employeeId } = validation.data;
  try {
    const updated = await updateTimesheetRequired(db, {
      companyId,
      employeeId,
      timesheetRequired: intent === "include",
      updatedBy: userId
    });
    if (!updated) {
      return data(
        {},
        await flash(
          request,
          error(null, "Set up the person's job before you change this")
        )
      );
    }
  } catch (err) {
    logger.error("Failed to update timesheetRequired", {
      companyId,
      employeeId,
      intent,
      error: err
    });
    return data({}, await flash(request, error(err, "Failed to update")));
  }

  return data(
    {},
    await flash(
      request,
      success(
        intent === "exclude"
          ? "Removed from the Missing Time report"
          : "Added back to the Missing Time report"
      )
    )
  );
}

type Row = MissingTimeEmployee;

export default function MissingTimeReportRoute() {
  const {
    startDate,
    endDate,
    fiscalStartMonth,
    excluded,
    excludedCount,
    options,
    rows
  } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const format = useReportFormat();
  const permissions = usePermissions();
  const [, setParams] = useUrlParams();
  const fetcher = useFetcher<typeof action>();
  const canChangePeople = permissions.can("update", "people");

  const columns = useMemo<ColumnDef<Row>[]>(() => {
    const filterOptions = (key: FilterKey) =>
      options[key].map((option) => ({
        value: option.value,
        label: <Enumerable value={option.label} />
      }));
    return [
      {
        id: "employeeId",
        header: t`Employee`,
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.employeeName ?? row.original.employeeId}
          </span>
        ),
        meta: {
          filter: { type: "static", options: filterOptions("employeeId") },
          icon: <LuUser />
        }
      },
      ...(excluded
        ? []
        : ([
            {
              id: "missingDays",
              header: t`Missing Days`,
              cell: ({ row }) => (
                <NumberCell>{row.original.dates.length}</NumberCell>
              )
            },
            {
              id: "firstDate",
              header: t`First Missing`,
              cell: ({ row }) => format.date(row.original.dates[0] ?? null)
            },
            {
              id: "lastDate",
              header: t`Last Missing`,
              cell: ({ row }) => format.date(row.original.dates.at(-1) ?? null)
            }
          ] satisfies ColumnDef<Row>[])),
      {
        id: "managerId",
        header: t`Manager`,
        cell: ({ row }) => row.original.managerName,
        meta: {
          filter: { type: "static", options: filterOptions("managerId") },
          icon: <LuUserCheck />
        }
      },
      {
        id: "departmentId",
        header: t`Department`,
        cell: ({ row }) =>
          row.original.departmentName ? (
            <Enumerable value={row.original.departmentName} />
          ) : null,
        meta: {
          filter: { type: "static", options: filterOptions("departmentId") },
          icon: <LuBuilding2 />
        }
      },
      {
        id: "locationId",
        header: t`Location`,
        cell: ({ row }) =>
          row.original.locationName ? (
            <Enumerable value={row.original.locationName} />
          ) : null,
        meta: {
          filter: { type: "static", options: filterOptions("locationId") },
          icon: <LuMapPin />
        }
      }
    ];
  }, [t, format, options, excluded]);

  const setIncluded = useCallback(
    (row: Row, include: boolean) => {
      fetcher.submit(
        { intent: include ? "include" : "exclude", employeeId: row.employeeId },
        { method: "post" }
      );
    },
    [fetcher]
  );

  const renderContextMenu = useCallback(
    (row: Row) => (
      <>
        <MenuItem asChild>
          <Link to={path.to.personJob(row.employeeId)}>
            <MenuIcon icon={<LuUser />} />
            <Trans>Open Person</Trans>
          </Link>
        </MenuItem>
        {excluded ? (
          <MenuItem
            disabled={!canChangePeople}
            onClick={() => setIncluded(row, true)}
          >
            <MenuIcon icon={<LuUserCheck />} />
            <Trans>Add Back to Report</Trans>
          </MenuItem>
        ) : (
          <MenuItem
            disabled={!canChangePeople}
            onClick={() => setIncluded(row, false)}
          >
            <MenuIcon icon={<LuUserX />} />
            <Trans>Exclude from Report</Trans>
          </MenuItem>
        )}
      </>
    ),
    [excluded, canChangePeople, setIncluded]
  );

  const renderActions = useCallback(
    (selected: Row[]) => (
      <DropdownMenuContent align="start" className="min-w-[200px]">
        <DropdownMenuItem
          disabled={selected.length === 0 || fetcher.state !== "idle"}
          onClick={() => {
            const formData = new FormData();
            formData.set("intent", "remind");
            formData.set("startDate", startDate);
            formData.set("endDate", endDate);
            for (const row of selected) {
              formData.append("employeeIds", row.employeeId);
            }
            fetcher.submit(formData, { method: "post" });
          }}
        >
          <LuBellRing className="mr-2 size-4" />
          <Trans>Send Reminder</Trans>
        </DropdownMenuItem>
      </DropdownMenuContent>
    ),
    [fetcher, startDate, endDate]
  );

  const renderExpandedRow = useCallback(
    (row: Row) => (
      <div className="flex flex-wrap gap-1.5 px-4 py-3">
        {row.dates.map((date) => (
          <Badge key={date} variant="secondary" className="tabular-nums">
            {format.date(date)}
          </Badge>
        ))}
      </div>
    ),
    [format]
  );

  return (
    <ProjectReport<Row>
      title={excluded ? t`Excluded from Missing Time` : t`Missing Time`}
      data={rows}
      columns={columns}
      withSearch
      getRowId={(row) => row.employeeId}
      filters={
        <>
          {!excluded && (
            <ReportRangeSelect fiscalStartMonth={fiscalStartMonth} />
          )}
          <Button
            variant="secondary"
            leftIcon={excluded ? <LuEye /> : <LuEyeOff />}
            onClick={() =>
              setParams({ excluded: excluded ? undefined : "true" })
            }
          >
            {excluded ? (
              <Trans>Back to Missing Time</Trans>
            ) : (
              <Trans>Excluded ({excludedCount})</Trans>
            )}
          </Button>
        </>
      }
      csvHref={
        excluded
          ? undefined
          : path.to.api.projectReport("missing-time", {
              from: startDate,
              to: endDate
            })
      }
      renderActions={excluded ? undefined : renderActions}
      renderContextMenu={renderContextMenu}
      renderExpandedRow={excluded ? undefined : renderExpandedRow}
    />
  );
}
