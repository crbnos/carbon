import { requirePermissions } from "@carbon/auth/auth.server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAccountsInScope,
  getActiveDimensionsWithValues,
  getDimensionPivot,
  getFiscalYearSettings,
  getReportViews,
  getScrapAccountIds
} from "~/modules/accounting";
import { loader } from "./analytics.$reportKey";

vi.mock("@carbon/auth", () => ({
  assertIsPost: vi.fn(),
  error: vi.fn((cause: unknown, message: string) => ({ cause, message })),
  success: vi.fn()
}));

vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: vi.fn()
}));

vi.mock("@carbon/auth/session.server", () => ({
  flash: vi.fn(async () => ({}))
}));

vi.mock("@carbon/react", () => ({
  VStack: vi.fn()
}));

vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => strings[0]
}));

vi.mock("@carbon/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@carbon/utils")>()),
  computeReportPeriodBuckets: vi.fn(() => []),
  datetime: { today: vi.fn(() => ({ toString: () => "2026-08-26" })) },
  defaultReportRange: vi.fn(() => ({
    startDate: "2026-03-01",
    endDate: "2026-08-26"
  }))
}));

const defaultPivotState = {
  rows: [],
  columnAxis: { type: "period", bucket: "month" },
  measure: "netChange",
  percentOfTotal: false,
  filters: [],
  accountIds: [],
  sort: null
};

vi.mock("~/modules/accounting", () => ({
  analyticsReportKeys: ["revenue", "scrap"],
  analyticsReports: {
    revenue: { accountScope: { classes: ["Revenue"] }, defaultRows: [] },
    scrap: { accountScope: { source: "scrapAccounts" }, defaultRows: [] }
  },
  applyPivotDisplayParams: vi.fn(),
  deleteReportView: vi.fn(),
  getAccountsInScope: vi.fn(),
  getActiveDimensionsWithValues: vi.fn(),
  getDimensionPivot: vi.fn(),
  getFiscalYearSettings: vi.fn(),
  getReportViews: vi.fn(),
  getScrapAccountIds: vi.fn(),
  pivotStateValidator: {
    parse: vi.fn(() => defaultPivotState),
    safeParse: vi.fn(() => ({ success: true, data: defaultPivotState }))
  },
  reportViewValidator: {},
  upsertReportView: vi.fn()
}));

vi.mock("~/modules/accounting/ui/Reports", () => ({
  downloadCsvRows: vi.fn(),
  getPeriodColumnLabel: vi.fn(),
  PivotControlBar: vi.fn(),
  PivotLinesDrawer: vi.fn(),
  PivotTree: vi.fn()
}));

vi.mock("~/modules/accounting/ui/Reports/pivotData", () => ({
  buildPivotTree: vi.fn(),
  canDownloadPivot: vi.fn(),
  pivotToCsvRows: vi.fn(),
  UNASSIGNED_COLUMN_KEY: "__unassigned__"
}));

vi.mock("~/hooks", () => ({
  useUrlParams: vi.fn()
}));

vi.mock("~/modules/shared", () => ({
  months: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ]
}));

vi.mock("~/modules/shared/timezone.server", () => ({
  getCompanyTimeZone: vi.fn(async () => "UTC")
}));

vi.mock("~/utils/path", () => ({
  path: {
    to: {
      accounting: "/x/accounting",
      analyticsReport: (reportKey: string) =>
        `/x/reports/analytics/${reportKey}`,
      api: { analyticsReportLines: vi.fn() }
    }
  }
}));

vi.mock("~/utils/revalidate", () => ({
  revalidateIgnoringPivotDisplay: vi.fn()
}));

const queryError = { message: "metadata lookup failed" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermissions).mockResolvedValue({
    client: {},
    companyId: "company-1",
    companyGroupId: "group-1",
    userId: "user-1"
  } as never);
  vi.mocked(getActiveDimensionsWithValues).mockResolvedValue({
    data: [],
    error: null
  } as never);
  vi.mocked(getReportViews).mockResolvedValue({
    data: [],
    error: null
  } as never);
  vi.mocked(getFiscalYearSettings).mockResolvedValue({
    data: { startMonth: "January" },
    error: null
  } as never);
  vi.mocked(getScrapAccountIds).mockResolvedValue({
    data: [],
    error: null
  } as never);
  vi.mocked(getAccountsInScope).mockResolvedValue({
    data: [],
    error: null
  } as never);
  vi.mocked(getDimensionPivot).mockResolvedValue({
    data: { groups: [], columnKeys: [], hasMore: false, valueNames: {} },
    error: null
  } as never);
});

type MetadataCase = {
  name: string;
  reportKey?: "revenue" | "scrap";
  arrange: () => void;
};

const metadataCases: MetadataCase[] = [
  {
    name: "dimension metadata errors",
    arrange: () =>
      vi.mocked(getActiveDimensionsWithValues).mockResolvedValue({
        data: [],
        error: queryError
      } as never)
  },
  {
    name: "dimension metadata is null",
    arrange: () =>
      vi.mocked(getActiveDimensionsWithValues).mockResolvedValue({
        data: null,
        error: null
      } as never)
  },
  {
    name: "saved-view metadata errors",
    arrange: () =>
      vi.mocked(getReportViews).mockResolvedValue({
        data: [],
        error: queryError
      } as never)
  },
  {
    name: "saved-view metadata is null",
    arrange: () =>
      vi.mocked(getReportViews).mockResolvedValue({
        data: null,
        error: null
      } as never)
  },
  {
    name: "scrap-account metadata errors",
    reportKey: "scrap",
    arrange: () =>
      vi.mocked(getScrapAccountIds).mockResolvedValue({
        data: [],
        error: queryError
      } as never)
  },
  {
    name: "scrap-account metadata is null",
    reportKey: "scrap",
    arrange: () =>
      vi.mocked(getScrapAccountIds).mockResolvedValue({
        data: null,
        error: null
      } as never)
  },
  {
    name: "account-scope metadata errors",
    arrange: () =>
      vi.mocked(getAccountsInScope).mockResolvedValue({
        data: [],
        error: queryError
      } as never)
  },
  {
    name: "account-scope metadata is null",
    arrange: () =>
      vi.mocked(getAccountsInScope).mockResolvedValue({
        data: null,
        error: null
      } as never)
  },
  {
    name: "account-scope metadata reaches the row cap",
    arrange: () =>
      vi.mocked(getAccountsInScope).mockResolvedValue({
        data: new Array(1000).fill({
          id: "account",
          number: "1000",
          name: "Account"
        }),
        error: null
      } as never)
  }
];

describe("analytics report metadata completeness", () => {
  it.each(
    metadataCases
  )("fails closed before pivot when $name", async (testCase) => {
    testCase.arrange();
    const request = new Request(
      `http://localhost/x/reports/analytics/${testCase.reportKey ?? "revenue"}`
    );

    await expect(
      loader({
        request,
        params: { reportKey: testCase.reportKey ?? "revenue" }
      } as never)
    ).rejects.toMatchObject({ status: 302 });

    expect(getDimensionPivot).not.toHaveBeenCalled();
  });
});
