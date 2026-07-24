import { Text, View } from "@react-pdf/renderer";
import { useTw } from "./blocks/tw";
import { LogoImage } from "./components/LogoImage";
import Template from "./components/Template";

// Local, self-contained prop types. `packages/documents` is a standalone
// package and must NOT import from the erp app, so the erp module's
// `StatementRow` / `CashFlowStatement` shapes are re-declared structurally
// here. Keep in sync with apps/erp/app/modules/accounting/types.ts.
type StatementRow = {
  name: string;
  number: string | null;
  depth: number;
  amount: number;
  isGroup: boolean;
  isComputed?: boolean;
};

type CashFlowLine = {
  accountId: string;
  number: string | null;
  name: string;
  amount: number;
};

type CashFlow = {
  netIncome: number;
  operating: CashFlowLine[];
  investing: CashFlowLine[];
  financing: CashFlowLine[];
  unclassified: CashFlowLine[];
  operatingTotal: number;
  investingTotal: number;
  financingTotal: number;
  unclassifiedTotal: number;
  netChangeInCash: number;
  beginningCash: number;
  endingCash: number;
  effectOfExchangeRates?: number;
};

type FinancialStatementsPDFProps = {
  company: { name: string; logo?: string | null };
  currencyCode: string;
  startDate: string | null;
  endDate: string | null;
  balanceSheet: StatementRow[];
  incomeStatement: StatementRow[];
  cashFlow: CashFlow;
};

function formatAmount(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/** Visible report header: company logo/name + report title + period + currency. */
function ReportHeader({
  company,
  currencyCode,
  startDate,
  endDate
}: {
  company: { name: string; logo?: string | null };
  currencyCode: string;
  startDate: string | null;
  endDate: string | null;
}) {
  const tw = useTw();
  const period =
    startDate && endDate
      ? `${startDate} — ${endDate}`
      : endDate
        ? `As of ${endDate}`
        : startDate
          ? `From ${startDate}`
          : "All dates";

  return (
    <View style={tw("mb-4")}>
      <View style={tw("flex flex-row justify-between items-start")}>
        <View style={tw("flex flex-row items-center")}>
          {company.logo ? (
            <LogoImage src={company.logo} height={28} marginRight={12} />
          ) : null}
          <Text style={tw("text-xl font-bold text-gray-800")}>
            {company.name}
          </Text>
        </View>
        <View style={tw("flex flex-col items-end")}>
          <Text style={tw("text-2xl font-bold text-gray-800")}>
            Financial Statements
          </Text>
          <Text style={tw("text-[9px] text-gray-600")}>{period}</Text>
          <Text style={tw("text-[9px] text-gray-600")}>
            Currency: {currencyCode}
          </Text>
        </View>
      </View>
      <View style={tw("h-[1px] bg-gray-200 mt-2")} />
    </View>
  );
}

/** A single indented statement row: name (left) + right-aligned amount. */
function StatementRowView({ row }: { row: StatementRow }) {
  const tw = useTw();
  const nameStyle = [
    tw("flex-1 text-[9px] text-gray-800"),
    { paddingLeft: row.depth * 8 },
    row.isGroup ? tw("font-bold") : {},
    row.isComputed ? tw("italic") : {}
  ];

  return (
    <View style={tw("flex flex-row py-[2px]")} wrap={false}>
      <Text style={nameStyle}>
        {row.name}
        {row.isComputed ? " (computed)" : ""}
      </Text>
      <Text
        style={[
          tw("w-24 text-right text-[9px] text-gray-800"),
          row.isGroup ? tw("font-bold") : {},
          row.isComputed ? tw("italic") : {}
        ]}
      >
        {formatAmount(row.amount)}
      </Text>
    </View>
  );
}

function StatementSection({
  title,
  rows
}: {
  title: string;
  rows: StatementRow[];
}) {
  const tw = useTw();
  return (
    <View style={tw("mb-5")} wrap>
      <Text style={tw("text-sm font-bold text-gray-600 mb-1")}>{title}</Text>
      <View style={tw("h-[1px] bg-gray-200 mb-1")} />
      {rows.length === 0 ? (
        <Text style={tw("text-[9px] italic text-gray-400 py-[2px]")}>
          No accounts
        </Text>
      ) : (
        rows.map((row, index) => (
          <StatementRowView
            key={`${row.number ?? row.name}-${index}`}
            row={row}
          />
        ))
      )}
    </View>
  );
}

/** A labelled line inside the cash flow section (line item or subtotal). */
function CashFlowRow({
  label,
  amount,
  depth = 0,
  bold = false,
  border = false
}: {
  label: string;
  amount: number;
  depth?: number;
  bold?: boolean;
  border?: boolean;
}) {
  const tw = useTw();
  return (
    <View
      style={[
        tw("flex flex-row py-[2px]"),
        border ? tw("border-t border-gray-200 mt-[1px]") : {}
      ]}
      wrap={false}
    >
      <Text
        style={[
          tw("flex-1 text-[9px] text-gray-800"),
          { paddingLeft: depth * 8 },
          bold ? tw("font-bold") : {}
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          tw("w-24 text-right text-[9px] text-gray-800"),
          bold ? tw("font-bold") : {}
        ]}
      >
        {formatAmount(amount)}
      </Text>
    </View>
  );
}

function CashFlowSection({ cashFlow }: { cashFlow: CashFlow }) {
  const tw = useTw();
  return (
    <View style={tw("mb-5")} wrap>
      <Text style={tw("text-sm font-bold text-gray-600 mb-1")}>
        Statement of Cash Flows
      </Text>
      <View style={tw("h-[1px] bg-gray-200 mb-1")} />

      {/* Operating activities: Net Income first, then lines, then total. */}
      <Text style={tw("text-[9px] font-bold text-gray-800 mt-1")}>
        Operating Activities
      </Text>
      <CashFlowRow label="Net Income" amount={cashFlow.netIncome} depth={1} />
      {cashFlow.operating.map((line) => (
        <CashFlowRow
          key={line.accountId}
          label={line.name}
          amount={line.amount}
          depth={1}
        />
      ))}
      <CashFlowRow
        label="Net cash from operating activities"
        amount={cashFlow.operatingTotal}
        depth={1}
        bold
        border
      />

      {/* Investing activities. */}
      <Text style={tw("text-[9px] font-bold text-gray-800 mt-2")}>
        Investing Activities
      </Text>
      {cashFlow.investing.map((line) => (
        <CashFlowRow
          key={line.accountId}
          label={line.name}
          amount={line.amount}
          depth={1}
        />
      ))}
      <CashFlowRow
        label="Net cash from investing activities"
        amount={cashFlow.investingTotal}
        depth={1}
        bold
        border
      />

      {/* Financing activities. */}
      <Text style={tw("text-[9px] font-bold text-gray-800 mt-2")}>
        Financing Activities
      </Text>
      {cashFlow.financing.map((line) => (
        <CashFlowRow
          key={line.accountId}
          label={line.name}
          amount={line.amount}
          depth={1}
        />
      ))}
      <CashFlowRow
        label="Net cash from financing activities"
        amount={cashFlow.financingTotal}
        depth={1}
        bold
        border
      />

      {/* Unclassified — only when there are lines. */}
      {cashFlow.unclassified.length > 0 && (
        <>
          <Text style={tw("text-[9px] font-bold text-gray-800 mt-2")}>
            Unclassified
          </Text>
          {cashFlow.unclassified.map((line) => (
            <CashFlowRow
              key={line.accountId}
              label={line.name}
              amount={line.amount}
              depth={1}
            />
          ))}
          <CashFlowRow
            label="Net cash from unclassified activities"
            amount={cashFlow.unclassifiedTotal}
            depth={1}
            bold
            border
          />
        </>
      )}

      {/* Effect of exchange rates — consolidated only. */}
      {cashFlow.effectOfExchangeRates !== undefined && (
        <CashFlowRow
          label="Effect of exchange rate changes on cash"
          amount={cashFlow.effectOfExchangeRates}
        />
      )}

      <View style={tw("mt-2")}>
        <CashFlowRow
          label="Net change in cash"
          amount={cashFlow.netChangeInCash}
          bold
          border
        />
        <CashFlowRow
          label="Cash at beginning of period"
          amount={cashFlow.beginningCash}
        />
        <CashFlowRow
          label="Cash at end of period"
          amount={cashFlow.endingCash}
          bold
        />
      </View>
    </View>
  );
}

/**
 * Financial Statements PDF — Balance Sheet, Income Statement, and Statement of
 * Cash Flows in a single document. Rendered inside the shared `Template` shell,
 * whose single <Page> auto-paginates overflowing section content across
 * physical pages (react-pdf flow), so no per-section <Page> deviation is needed;
 * the header/footer band comes from Template.
 */
const FinancialStatementsPDF = ({
  company,
  currencyCode,
  startDate,
  endDate,
  balanceSheet,
  incomeStatement,
  cashFlow
}: FinancialStatementsPDFProps) => {
  return (
    <Template
      title="Financial Statements"
      meta={{
        author: "Carbon",
        keywords: "financial statements",
        subject: "Financial Statements"
      }}
    >
      <ReportHeader
        company={company}
        currencyCode={currencyCode}
        startDate={startDate}
        endDate={endDate}
      />
      <StatementSection title="Balance Sheet" rows={balanceSheet} />
      <StatementSection title="Income Statement" rows={incomeStatement} />
      <CashFlowSection cashFlow={cashFlow} />
    </Template>
  );
};

export default FinancialStatementsPDF;
