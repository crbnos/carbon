import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  Badge,
  cn,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import type { IconType } from "react-icons";
import {
  LuArrowUpDown,
  LuBanknote,
  LuBookmark,
  LuBoxes,
  LuBriefcase,
  LuFactory,
  LuFileSpreadsheet,
  LuHandCoins,
  LuPin,
  LuRecycle,
  LuScale,
  LuSearch,
  LuTrendingUp,
  LuTruck,
  LuUsers
} from "react-icons/lu";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction
} from "react-router";
import { data, Link, useFetcher, useLoaderData } from "react-router";
import {
  getReportPins,
  getReportViews,
  reportPinValidator,
  upsertReportPin
} from "~/modules/accounting";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Reports" }];
};

export const handle: Handle = {
  breadcrumb: msg`Reports`,
  to: path.to.reports
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const [pins, savedViews] = await Promise.all([
    getReportPins(client, userId, companyId),
    getReportViews(client, { companyId })
  ]);

  return {
    pinOverrides: pins.data ?? [],
    savedViews: savedViews.data ?? []
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const validation = await validator(reportPinValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const { reportKey, pinned } = validation.data;

  const result = await upsertReportPin(client, {
    reportKey,
    pinned: pinned === "true",
    userId,
    companyId
  });

  if (result.error) {
    return data(
      {},
      await flash(request, error(result.error, "Failed to update pin"))
    );
  }

  return {};
}

type ReportDefinition = {
  key: string;
  name: string;
  description: string;
  to: string;
  icon: IconType;
  category: string;
  defaultPinned: boolean;
};

export default function ReportsIndexRoute() {
  const { pinOverrides, savedViews } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const [search, setSearch] = useState("");
  const pinFetcher = useFetcher<typeof action>();

  // The core financial statements default to pinned; users can pin/unpin from
  // the cards and list rows below (persisted per user + company).
  const reports = useMemo<ReportDefinition[]>(
    () => [
      {
        key: "income-statement",
        name: t`Income Statement`,
        description: t`Revenue and expenses over a period`,
        to: path.to.incomeStatement,
        icon: LuTrendingUp,
        category: t`Financial Statements`,
        defaultPinned: true
      },
      {
        key: "executive-pnl",
        name: t`Executive P&L`,
        description: t`Condensed P&L with margins and key subtotals`,
        to: path.to.executivePnl,
        icon: LuBriefcase,
        category: t`Financial Statements`,
        defaultPinned: false
      },
      {
        key: "balance-sheet",
        name: t`Balance Sheet`,
        description: t`Assets, liabilities and equity as of a date`,
        to: path.to.balanceSheet,
        icon: LuScale,
        category: t`Financial Statements`,
        defaultPinned: true
      },
      {
        key: "trial-balance",
        name: t`Trial Balance`,
        description: t`Account balances with debits and credits`,
        to: path.to.trialBalance,
        icon: LuFileSpreadsheet,
        category: t`Close Reports`,
        defaultPinned: true
      },
      {
        key: "inventory-valuation",
        name: t`Inventory Valuation`,
        description: t`On-hand value by location or item, with GL tie-out`,
        to: path.to.inventoryValuation,
        icon: LuBoxes,
        category: t`Close Reports`,
        defaultPinned: false
      },
      {
        key: "revenue",
        name: t`Revenue`,
        description: t`Slice revenue by customer, customer type, or any dimension`,
        to: path.to.analyticsReport("revenue"),
        icon: LuUsers,
        category: t`Analytics`,
        defaultPinned: false
      },
      {
        key: "expenses",
        name: t`Expenses`,
        description: t`Slice expenses by supplier, supplier type, or any dimension`,
        to: path.to.analyticsReport("expenses"),
        icon: LuTruck,
        category: t`Analytics`,
        defaultPinned: false
      },
      {
        key: "cogs",
        name: t`COGS`,
        description: t`Cost of goods sold by item group, item, or any dimension`,
        to: path.to.analyticsReport("cogs"),
        icon: LuFactory,
        category: t`Analytics`,
        defaultPinned: false
      },
      {
        key: "inventory-change",
        name: t`Inventory Change`,
        description: t`What drove inventory up or down, by any dimension`,
        to: path.to.analyticsReport("inventory-change"),
        icon: LuArrowUpDown,
        category: t`Analytics`,
        defaultPinned: false
      },
      {
        key: "scrap",
        name: t`Scrap`,
        description: t`Biggest causes of scrap by reason, item, or work center`,
        to: path.to.analyticsReport("scrap"),
        icon: LuRecycle,
        category: t`Analytics`,
        defaultPinned: false
      },
      {
        key: "ar-aging",
        name: t`AR Aging`,
        description: t`Open receivables by customer and age`,
        to: path.to.arAging,
        icon: LuHandCoins,
        category: t`Analytics`,
        defaultPinned: false
      },
      {
        key: "ap-aging",
        name: t`AP Aging`,
        description: t`Open payables by supplier and age`,
        to: path.to.apAging,
        icon: LuBanknote,
        category: t`Analytics`,
        defaultPinned: false
      }
    ],
    [t]
  );

  // Persisted overrides + optimistic in-flight toggle
  const isPinned = (report: ReportDefinition): boolean => {
    if (
      pinFetcher.formData &&
      pinFetcher.formData.get("reportKey") === report.key
    ) {
      return pinFetcher.formData.get("pinned") === "true";
    }
    const override = pinOverrides.find((p) => p.reportKey === report.key);
    return override?.pinned ?? report.defaultPinned;
  };

  const togglePin = (report: ReportDefinition, pinned: boolean) => {
    pinFetcher.submit(
      { reportKey: report.key, pinned: String(pinned) },
      { method: "post", action: path.to.reports }
    );
  };

  const filtered = useMemo(() => {
    const lower = search.trim().toLowerCase();
    if (!lower) return reports;
    return reports.filter(
      (report) =>
        report.name.toLowerCase().includes(lower) ||
        report.description.toLowerCase().includes(lower)
    );
  }, [reports, search]);

  const categories = useMemo(() => {
    const result = new Map<string, ReportDefinition[]>();
    for (const report of filtered) {
      const list = result.get(report.category) ?? [];
      list.push(report);
      result.set(report.category, list);
    }
    return [...result.entries()];
  }, [filtered]);

  const pinned = reports.filter(isPinned);

  return (
    <div className="h-full w-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col p-8">
        <div className="mb-8 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            <Trans>Reporting</Trans>
          </h1>
          <InputGroup size="sm" className="w-64">
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

        {pinned.length > 0 && (
          <>
            <SectionHeading>
              <LuPin className="h-3 w-3" />
              <Trans>Pinned</Trans>
            </SectionHeading>
            <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {pinned.map((report) => (
                <Link
                  key={report.key}
                  to={report.to}
                  prefetch="intent"
                  className="group flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border bg-card/70 p-4 backdrop-blur-md transition-colors duration-200 hover:border-foreground/20 hover:bg-accent/40"
                >
                  <span className="flex items-center gap-3 overflow-hidden">
                    <span className="shrink-0 rounded-lg border border-border p-2.5 transition-colors group-hover:border-foreground/20">
                      <report.icon className="text-xl" />
                    </span>
                    <span className="truncate text-sm font-medium tracking-tight">
                      {report.name}
                    </span>
                  </span>
                  <PinToggle
                    report={report}
                    pinned
                    onToggle={togglePin}
                    unpinLabel={t`Unpin ${report.name}`}
                    pinLabel={t`Pin ${report.name}`}
                  />
                </Link>
              ))}
            </div>
          </>
        )}

        {categories.map(([category, categoryReports]) => {
          // Saved pivot views belong to a report card (by reportKey); show them
          // directly beneath the category that hosts that card (Analytics).
          const categoryViews = savedViews.filter((view) =>
            categoryReports.some((report) => report.key === view.reportKey)
          );
          return (
            <div key={category} className="mb-8">
              <SectionHeading>{category}</SectionHeading>
              <div className="overflow-hidden rounded-lg border border-border">
                {categoryReports.map((report, index) => (
                  <Link
                    key={report.key}
                    to={report.to}
                    prefetch="intent"
                    className={
                      "flex cursor-pointer items-center gap-3 bg-card/70 px-4 py-2.5 transition-colors hover:bg-accent/40" +
                      (index > 0 ? " border-t border-border" : "")
                    }
                  >
                    <report.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm font-medium">{report.name}</span>
                    <span className="truncate text-sm text-muted-foreground">
                      {report.description}
                    </span>
                    <span className="ml-auto">
                      <PinToggle
                        report={report}
                        pinned={isPinned(report)}
                        onToggle={togglePin}
                        unpinLabel={t`Unpin ${report.name}`}
                        pinLabel={t`Pin ${report.name}`}
                      />
                    </span>
                  </Link>
                ))}
              </div>
              {categoryViews.length > 0 && (
                <div className="mt-4">
                  <SectionHeading>
                    <LuBookmark className="h-3 w-3" />
                    <Trans>Saved Views</Trans>
                  </SectionHeading>
                  <div className="overflow-hidden rounded-lg border border-border">
                    {categoryViews.map((view, index) => (
                      <Link
                        key={view.id}
                        to={`${path.to.analyticsReport(view.reportKey)}?view=${view.id}`}
                        prefetch="intent"
                        className={
                          "flex cursor-pointer items-center gap-3 bg-card/70 px-4 py-2.5 transition-colors hover:bg-accent/40" +
                          (index > 0 ? " border-t border-border" : "")
                        }
                      >
                        <LuBookmark className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="text-sm font-medium">{view.name}</span>
                        <span className="truncate text-sm text-muted-foreground">
                          {
                            categoryReports.find(
                              (report) => report.key === view.reportKey
                            )?.name
                          }
                        </span>
                        {view.visibility === "Company" && (
                          <span className="ml-auto">
                            <Badge variant="secondary">
                              <Trans>Shared</Trans>
                            </Badge>
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">
            <Trans>No reports match your search.</Trans>
          </p>
        )}
      </div>
    </div>
  );
}

// Sits inside the card/row Link, so it must not trigger navigation. Pinned
// shows a solid pin; unpinned shows a muted pin that fills in on hover.
const PinToggle = ({
  report,
  pinned,
  onToggle,
  pinLabel,
  unpinLabel
}: {
  report: ReportDefinition;
  pinned: boolean;
  onToggle: (report: ReportDefinition, pinned: boolean) => void;
  pinLabel: string;
  unpinLabel: string;
}) => (
  <IconButton
    aria-label={pinned ? unpinLabel : pinLabel}
    variant="ghost"
    size="sm"
    className={cn(
      pinned
        ? "text-foreground"
        : "text-muted-foreground/50 hover:text-foreground"
    )}
    icon={<LuPin />}
    onClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
      onToggle(report, !pinned);
    }}
  />
);

const SectionHeading = ({ children }: { children: ReactNode }) => (
  <div className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
    {children}
  </div>
);
