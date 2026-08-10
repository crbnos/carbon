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
  LuFileSpreadsheet,
  LuHandCoins,
  LuPin,
  LuRecycle,
  LuScale,
  LuSearch,
  LuTrash2,
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
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
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
    currentUserId: userId,
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

type SavedView = Awaited<ReturnType<typeof loader>>["savedViews"][number];

// Saved views reuse the reportPin table (free-text reportKey) via a namespaced
// key, so pinning a view needs no separate schema. Views default to unpinned.
const viewPinKey = (view: SavedView) => `view:${view.id}`;

export default function ReportsIndexRoute() {
  const { currentUserId, pinOverrides, savedViews } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const [search, setSearch] = useState("");
  const [viewPendingDelete, setViewPendingDelete] = useState<SavedView | null>(
    null
  );
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
        description: t`Slice expenses by location, cost center, or any dimension`,
        to: path.to.analyticsReport("expenses"),
        icon: LuTruck,
        category: t`Analytics`,
        defaultPinned: false
      },
      {
        key: "purchases",
        name: t`Purchases`,
        description: t`Spend by supplier, item, or category — your biggest cost drivers`,
        to: path.to.purchasesReport,
        icon: LuHandCoins,
        category: t`Analytics`,
        defaultPinned: false
      },
      {
        key: "assets",
        name: t`Assets`,
        description: t`Slice asset activity by location, item, or any dimension`,
        to: path.to.analyticsReport("assets"),
        icon: LuBanknote,
        category: t`Analytics`,
        defaultPinned: false
      },
      {
        key: "inventory-change",
        name: t`Inventory`,
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
        category: t`Aging`,
        defaultPinned: false
      },
      {
        key: "ap-aging",
        name: t`AP Aging`,
        description: t`Open payables by supplier and age`,
        to: path.to.apAging,
        icon: LuBanknote,
        category: t`Aging`,
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

  const isViewPinned = (view: SavedView): boolean => {
    const key = viewPinKey(view);
    if (pinFetcher.formData && pinFetcher.formData.get("reportKey") === key) {
      return pinFetcher.formData.get("pinned") === "true";
    }
    return pinOverrides.find((p) => p.reportKey === key)?.pinned ?? false;
  };

  const toggleViewPin = (view: SavedView, pinned: boolean) => {
    pinFetcher.submit(
      { reportKey: viewPinKey(view), pinned: String(pinned) },
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

  const pinnedReports = reports.filter(isPinned);
  const pinnedViews = savedViews.filter(isViewPinned);
  const hasPinned = pinnedReports.length > 0 || pinnedViews.length > 0;

  return (
    <div className="h-[calc(100dvh-var(--header-height))] w-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-8">
        <div className="flex items-center justify-between gap-4">
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

        {hasPinned && (
          <div>
            <SectionHeading>
              <LuPin className="h-3 w-3" />
              <Trans>Pinned</Trans>
            </SectionHeading>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {pinnedReports.map((report) => (
                <PinnedCard
                  key={report.key}
                  to={report.to}
                  icon={report.icon}
                  name={report.name}
                  pinned
                  onToggle={(next) => togglePin(report, next)}
                  pinLabel={t`Pin ${report.name}`}
                  unpinLabel={t`Unpin ${report.name}`}
                />
              ))}
              {pinnedViews.map((view) => (
                <PinnedCard
                  key={view.id}
                  to={`${path.to.analyticsReport(view.reportKey)}?view=${view.id}`}
                  icon={LuBookmark}
                  name={view.name}
                  pinned
                  onToggle={(next) => toggleViewPin(view, next)}
                  pinLabel={t`Pin ${view.name}`}
                  unpinLabel={t`Unpin ${view.name}`}
                />
              ))}
            </div>
          </div>
        )}

        {categories.map(([category, categoryReports]) => {
          // Saved pivot views belong to a report card (by reportKey); show them
          // directly beneath the category that hosts that card (Analytics).
          const categoryViews = savedViews.filter((view) =>
            categoryReports.some((report) => report.key === view.reportKey)
          );
          return (
            <div key={category} className="flex flex-col gap-8">
              <div>
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
                          pinned={isPinned(report)}
                          onToggle={(next) => togglePin(report, next)}
                          unpinLabel={t`Unpin ${report.name}`}
                          pinLabel={t`Pin ${report.name}`}
                        />
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
              {categoryViews.length > 0 && (
                <div>
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
                        <span className="ml-auto flex items-center gap-1">
                          {view.visibility === "Company" && (
                            <Badge variant="secondary">
                              <Trans>Shared</Trans>
                            </Badge>
                          )}
                          <PinToggle
                            pinned={isViewPinned(view)}
                            onToggle={(next) => toggleViewPin(view, next)}
                            unpinLabel={t`Unpin ${view.name}`}
                            pinLabel={t`Pin ${view.name}`}
                          />
                          {view.createdBy === currentUserId && (
                            <IconButton
                              aria-label={t`Delete ${view.name}`}
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground/50 hover:text-destructive-foreground"
                              icon={<LuTrash2 />}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setViewPendingDelete(view);
                              }}
                            />
                          )}
                        </span>
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
      {viewPendingDelete && (
        <ConfirmDelete
          action={path.to.deleteReportView(viewPendingDelete.id)}
          name={viewPendingDelete.name}
          text={t`Are you sure you want to delete the "${viewPendingDelete.name}" view? This cannot be undone.`}
          onCancel={() => setViewPendingDelete(null)}
          onSubmit={() => setViewPendingDelete(null)}
        />
      )}
    </div>
  );
}

// A pinned item (report or saved view) rendered as a card in the Pinned grid.
const PinnedCard = ({
  to,
  icon: Icon,
  name,
  pinned,
  onToggle,
  pinLabel,
  unpinLabel
}: {
  to: string;
  icon: IconType;
  name: string;
  pinned: boolean;
  onToggle: (pinned: boolean) => void;
  pinLabel: string;
  unpinLabel: string;
}) => (
  <Link
    to={to}
    prefetch="intent"
    className="group flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border bg-card/70 p-4 backdrop-blur-md transition-colors duration-200 hover:border-foreground/20 hover:bg-accent/40"
  >
    <span className="flex items-center gap-3 overflow-hidden">
      <span className="shrink-0 rounded-lg border border-border p-2.5 transition-colors group-hover:border-foreground/20">
        <Icon className="text-xl" />
      </span>
      <span className="truncate text-sm font-medium tracking-tight">
        {name}
      </span>
    </span>
    <PinToggle
      pinned={pinned}
      onToggle={onToggle}
      pinLabel={pinLabel}
      unpinLabel={unpinLabel}
    />
  </Link>
);

// Sits inside the card/row Link, so it must not trigger navigation. Pinned
// shows a solid pin; unpinned shows a muted pin that fills in on hover.
const PinToggle = ({
  pinned,
  onToggle,
  pinLabel,
  unpinLabel
}: {
  pinned: boolean;
  onToggle: (pinned: boolean) => void;
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
      onToggle(!pinned);
    }}
  />
);

const SectionHeading = ({ children }: { children: ReactNode }) => (
  <div className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
    {children}
  </div>
);
