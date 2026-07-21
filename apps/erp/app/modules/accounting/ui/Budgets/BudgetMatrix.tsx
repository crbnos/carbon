import { useCarbon } from "@carbon/auth";
import {
  Badge,
  Button,
  HStack,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast
} from "@carbon/react";
import { useCallback, useMemo, useState } from "react";
import { LuDownload, LuUpload } from "react-icons/lu";
import { Link } from "react-router";
import EditableNumberCell from "~/components/EditableNumberCell";
import { ImportCSVModal } from "~/components/ImportCSVModal";
import { path } from "~/utils/path";
import type { Budget, BudgetLine } from "../../types";

type MatrixAccount = {
  id: string;
  number: string | null;
  name: string | null;
  class: string | null;
  incomeBalance: string | null;
};

type MatrixPeriod = { id: string; periodNumber: number };

// GL-signed storage: debit-normal classes store the entered value as-is;
// credit-normal classes store its negation. Display reverses the mapping so the
// user always enters/reads a natural positive figure for the account class.
const isDebitNormal = (accountClass: string | null) =>
  accountClass === "Asset" || accountClass === "Expense";
const toStored = (value: number, accountClass: string | null) =>
  isDebitNormal(accountClass) ? value : -value;
const toDisplay = (amount: number, accountClass: string | null) =>
  isDebitNormal(accountClass) ? amount : -amount;

const cellKey = (accountId: string, periodId: string) =>
  `${accountId}:${periodId}`;

function buildCells(all: BudgetLine[], cc: string | null) {
  const next: Record<string, { id: string | null; amount: number }> = {};
  for (const line of all) {
    if ((line.costCenterId ?? null) !== cc) continue;
    next[cellKey(line.accountId, line.accountingPeriodId)] = {
      id: line.id,
      amount: line.amount
    };
  }
  return next;
}

export function BudgetMatrix({
  budget,
  accounts,
  periods,
  lines,
  costCenters,
  companyId,
  userId
}: {
  budget: Budget;
  accounts: MatrixAccount[];
  periods: MatrixPeriod[];
  lines: BudgetLine[];
  costCenters: { id: string; name: string }[];
  companyId: string;
  userId: string;
}) {
  const { carbon } = useCarbon();
  const isEditable = budget.status === "Draft";

  // null = company-level cells
  const [costCenterId, setCostCenterId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [classFilter, setClassFilter] = useState<"Income Statement" | "All">(
    "Income Statement"
  );
  const [search, setSearch] = useState("");

  const [allLines, setAllLines] = useState<BudgetLine[]>(lines);
  const [cells, setCells] = useState<
    Record<string, { id: string | null; amount: number }>
  >(() => buildCells(lines, null));

  const switchCostCenter = useCallback(
    (cc: string | null) => {
      setCostCenterId(cc);
      setCells(buildCells(allLines, cc));
    },
    [allLines]
  );

  const visibleAccounts = useMemo(
    () =>
      accounts.filter((a) => {
        if (
          classFilter === "Income Statement" &&
          a.incomeBalance !== "Income Statement"
        )
          return false;
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          (a.number ?? "").toLowerCase().includes(q) ||
          (a.name ?? "").toLowerCase().includes(q)
        );
      }),
    [accounts, classFilter, search]
  );

  const writeCell = useCallback(
    async (account: MatrixAccount, periodId: string, displayValue: number) => {
      if (!carbon) return;
      const key = cellKey(account.id, periodId);
      const existing = cells[key];
      const stored = toStored(displayValue, account.class);

      // optimistic
      setCells((prev) => ({
        ...prev,
        [key]: { id: existing?.id ?? null, amount: stored }
      }));

      if (displayValue === 0 && existing?.id) {
        const del = await (carbon as any)
          .from("budgetLine")
          .delete()
          .eq("id", existing.id)
          .eq("companyId", companyId);
        if (del?.error) {
          toast.error("Failed to clear budget amount");
          setCells((prev) => ({ ...prev, [key]: existing }));
          return;
        }
        setCells((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        setAllLines((prev) => prev.filter((l) => l.id !== existing.id));
        return;
      }

      if (existing?.id) {
        const update = await (carbon as any)
          .from("budgetLine")
          .update({
            amount: stored,
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
          .eq("id", existing.id)
          .eq("companyId", companyId);
        if (update?.error) {
          toast.error("Failed to update budget amount");
          setCells((prev) => ({ ...prev, [key]: existing }));
        } else {
          setAllLines((prev) =>
            prev.map((l) =>
              l.id === existing.id ? { ...l, amount: stored } : l
            )
          );
        }
      } else if (displayValue !== 0) {
        const insert = await (carbon as any)
          .from("budgetLine")
          .insert({
            budgetId: budget.id,
            companyId,
            accountId: account.id,
            accountingPeriodId: periodId,
            costCenterId,
            amount: stored,
            createdBy: userId
          })
          .select("id")
          .single();
        if (insert?.error || !insert?.data) {
          toast.error("Failed to save budget amount");
          setCells((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
        } else {
          const newLine: BudgetLine = {
            id: insert.data.id,
            companyId,
            budgetId: budget.id,
            accountId: account.id,
            accountingPeriodId: periodId,
            costCenterId,
            amount: stored
          };
          setCells((prev) => ({
            ...prev,
            [key]: { id: newLine.id, amount: stored }
          }));
          setAllLines((prev) => [...prev, newLine]);
        }
      }
    },
    [carbon, cells, companyId, userId, budget.id, costCenterId]
  );

  // "Fill": copy P1's value across P2..Pn.
  const fillRow = useCallback(
    (account: MatrixAccount) => {
      const first = cells[cellKey(account.id, periods[0]?.id ?? "")];
      if (!first) return;
      const displayValue = toDisplay(first.amount, account.class);
      for (const period of periods.slice(1)) {
        void writeCell(account, period.id, displayValue);
      }
    },
    [cells, periods, writeCell]
  );

  // "Distribute": treat P1's value as an annual figure and spread it evenly.
  const distributeRow = useCallback(
    (account: MatrixAccount) => {
      const first = cells[cellKey(account.id, periods[0]?.id ?? "")];
      if (!first) return;
      const annual = toDisplay(first.amount, account.class);
      const per = Math.round((annual / periods.length) * 100) / 100;
      for (const period of periods) {
        void writeCell(account, period.id, per);
      }
    },
    [cells, periods, writeCell]
  );

  const exportCsv = useCallback(() => {
    const header = [
      "budget",
      "accountNumber",
      "costCenter",
      ...periods.map((p) => `period${p.periodNumber}`)
    ];
    const ccName = costCenters.find((c) => c.id === costCenterId)?.name ?? "";
    const rows = visibleAccounts
      .map((account) => {
        const values = periods.map((p) => {
          const cell = cells[cellKey(account.id, p.id)];
          return cell ? toDisplay(cell.amount, account.class) : "";
        });
        if (values.every((v) => v === "")) return null;
        return [budget.name, account.number ?? "", ccName, ...values];
      })
      .filter(Boolean) as (string | number)[][];
    const csv = [header, ...rows]
      .map((row) =>
        row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${budget.name}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [budget.name, cells, costCenterId, costCenters, periods, visibleAccounts]);

  return (
    <div className="w-full">
      <div className="flex px-4 py-3 items-center gap-2 justify-between bg-card border-b border-border w-full flex-wrap">
        <HStack>
          <span className="text-sm font-medium">{budget.name}</span>
          <Badge variant={budget.status === "Approved" ? "green" : "outline"}>
            {budget.status}
          </Badge>
          <span className="text-sm text-muted-foreground">
            FY{budget.fiscalYear}
          </span>
        </HStack>
        <HStack>
          <select
            className="h-8 rounded-md border border-border bg-card px-2 text-sm"
            value={costCenterId ?? ""}
            onChange={(e) => switchCostCenter(e.target.value || null)}
          >
            <option value="">Company-level</option>
            {costCenters.map((cc) => (
              <option key={cc.id} value={cc.id}>
                {cc.name}
              </option>
            ))}
          </select>
          <select
            className="h-8 rounded-md border border-border bg-card px-2 text-sm"
            value={classFilter}
            onChange={(e) =>
              setClassFilter(e.target.value as "Income Statement" | "All")
            }
          >
            <option value="Income Statement">Income Statement</option>
            <option value="All">All Accounts</option>
          </select>
          <input
            className="h-8 rounded-md border border-border bg-card px-2 text-sm"
            placeholder="Search accounts"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button
            variant="secondary"
            leftIcon={<LuDownload />}
            onClick={exportCsv}
          >
            Export
          </Button>
          {isEditable && (
            <Button
              variant="secondary"
              leftIcon={<LuUpload />}
              onClick={() => setShowImport(true)}
            >
              Import
            </Button>
          )}
        </HStack>
      </div>

      {!isEditable && (
        <div className="px-4 py-2 text-sm bg-muted text-muted-foreground border-b border-border">
          This budget is {budget.status.toLowerCase()} and read-only. Copy it to
          a new draft from the{" "}
          <Link className="underline" to={path.to.newBudget}>
            New Budget
          </Link>{" "}
          form to revise.
        </div>
      )}

      <div className="overflow-auto">
        <Table>
          <Thead>
            <Tr>
              <Th className="w-[280px] sticky left-0 bg-card z-10">Account</Th>
              {periods.map((p) => (
                <Th key={p.id} className="text-right min-w-[110px]">
                  P{p.periodNumber}
                </Th>
              ))}
              <Th className="text-right min-w-[120px]">Total</Th>
              {isEditable && <Th className="w-[130px]" />}
            </Tr>
          </Thead>
          <Tbody>
            {visibleAccounts.map((account) => {
              const rowTotal = periods.reduce((sum, p) => {
                const cell = cells[cellKey(account.id, p.id)];
                return sum + (cell ? toDisplay(cell.amount, account.class) : 0);
              }, 0);
              return (
                <Tr key={account.id} className="group">
                  <Td className="sticky left-0 bg-card z-10 border-r border-border">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">
                        {account.number}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">
                        {account.name}
                      </span>
                    </div>
                  </Td>
                  {periods.map((p) => {
                    const cell = cells[cellKey(account.id, p.id)];
                    const display = cell
                      ? toDisplay(cell.amount, account.class)
                      : 0;
                    return (
                      <Td
                        key={p.id}
                        className="text-right group-hover:bg-muted/50"
                      >
                        <EditableNumberCell
                          value={display}
                          formatOptions={{
                            style: "decimal",
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                          }}
                          isEditable={isEditable}
                          onChange={(value) =>
                            writeCell(account, p.id, value ?? 0)
                          }
                        />
                      </Td>
                    );
                  })}
                  <Td className="text-right font-medium tabular-nums">
                    {rowTotal.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                    })}
                  </Td>
                  {isEditable && (
                    <Td>
                      <HStack spacing={1}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => fillRow(account)}
                        >
                          Fill
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => distributeRow(account)}
                        >
                          ÷12
                        </Button>
                      </HStack>
                    </Td>
                  )}
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </div>

      {showImport && (
        <ImportCSVModal
          table="budgetLine"
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  );
}
