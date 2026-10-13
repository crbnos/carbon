// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  AccountImportCompany,
  AccountImportError,
  AccountImportPlan,
  AccountImportRow,
  AccountNeedsTargetReason
} from "@carbon/database/account-import";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Combobox,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { SetupSection } from "~/components/Setup";
import type { AccountImportCsvError } from "../../account-import-csv";

export type AccountImportAccount = { number: string | null; name: string };

type AccountImportReviewProps = {
  plan: AccountImportPlan;
  rows: AccountImportRow[];
  accounts: Record<string, AccountImportAccount>;
  companies: AccountImportCompany[];
  targets: Record<string, number>;
  onTarget: (accountId: string, line: number | null) => void;
};

const label = (account: AccountImportAccount | undefined) =>
  account ? [account.number, account.name].filter(Boolean).join(" ") : "";

export function AccountImportCsvErrors({
  errors
}: {
  errors: AccountImportCsvError[];
}) {
  return (
    <Alert variant="destructive">
      <LuTriangleAlert />
      <AlertTitle>
        <Trans>The file could not be read</Trans>
      </AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-4">
          {errors.map((error, i) => (
            <li key={i}>
              <CsvErrorMessage error={error} />
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function CsvErrorMessage({ error }: { error: AccountImportCsvError }) {
  switch (error.code) {
    case "empty-file":
      return <Trans>The file has no rows.</Trans>;
    case "missing-columns": {
      const columns = error.columns.join(", ");
      return <Trans>The file has no {columns} column.</Trans>;
    }
    case "missing-number":
      return <Trans>Line {error.line} has no number.</Trans>;
    case "missing-name":
      return <Trans>Line {error.line} has no name.</Trans>;
    case "missing-group":
      return <Trans>Line {error.line} has no group.</Trans>;
    case "invalid-class": {
      const value = error.value;
      return (
        <Trans>
          Line {error.line}: "{value}" is not a class. Use Asset, Liability,
          Equity, Revenue or Expense.
        </Trans>
      );
    }
  }
}

function PlanErrorMessage({
  error,
  accounts
}: {
  error: AccountImportError;
  accounts: Record<string, AccountImportAccount>;
}) {
  const account = "accountId" in error ? label(accounts[error.accountId]) : "";
  switch (error.code) {
    case "duplicate-number": {
      const { line, firstLine, value } = error;
      return (
        <Trans>
          Line {line}: number {value} is already on line {firstLine}.
        </Trans>
      );
    }
    case "duplicate-name": {
      const { line, firstLine, value } = error;
      return (
        <Trans>
          Line {line}: name "{value}" is already on line {firstLine}.
        </Trans>
      );
    }
    case "unknown-carbon-account": {
      const { line, value } = error;
      return (
        <Trans>
          Line {line}: "{value}" is not a Carbon account number or role.
        </Trans>
      );
    }
    case "carbon-account-claimed-twice": {
      const { line, firstLine } = error;
      return (
        <Trans>
          Line {line}: {account} is already named on line {firstLine}.
        </Trans>
      );
    }
    case "class-mismatch":
      return (
        <Trans>
          Line {error.line}: {account} has a different class. It backs a default
          account, so its class cannot change.
        </Trans>
      );
    case "missing-class":
      return <Trans>Line {error.line}: a new account needs a class.</Trans>;
    case "invalid-type": {
      const { line, value } = error;
      return (
        <Trans>
          Line {line}: "{value}" is not an account type.
        </Trans>
      );
    }
    case "class-change-with-history":
      return (
        <Trans>
          Line {error.line}: {account} has postings, so its class cannot change.
        </Trans>
      );
    case "control-account-with-history":
      return (
        <Trans>
          {account} has postings and backs a control account. Rename it, but do
          not merge or remove it.
        </Trans>
      );
    case "migration-clearing-not-equity":
      return (
        <Trans>
          Line {error.line}: Migration Clearing must be an Equity account.
        </Trans>
      );
    case "taken-by-inactive-account": {
      const line = error.line;
      if (error.retiredByThisImport) {
        return (
          <Trans>
            Line {line}: {account} keeps this {error.field} after the import,
            because it has history. Pick another {error.field}.
          </Trans>
        );
      }
      return (
        <Trans>
          Line {line}: inactive account {account} holds this {error.field}. Name
          it in Carbon Account to reactivate it, or pick another {error.field}.
        </Trans>
      );
    }
    case "group-class-mismatch": {
      const { line, group } = error;
      return (
        <Trans>
          Line {line}: group "{group}" holds accounts of another class.
        </Trans>
      );
    }
    case "target-not-in-sheet":
      return (
        <Trans>The target picked for {account} is no longer in the file.</Trans>
      );
  }
}

function ReasonBadge({ reason }: { reason: AccountNeedsTargetReason }) {
  switch (reason) {
    case "references":
      return (
        <Badge variant="secondary">
          <Trans>References</Trans>
        </Badge>
      );
    case "required-role":
      return (
        <Badge variant="secondary">
          <Trans>Default account</Trans>
        </Badge>
      );
    case "balance":
      return (
        <Badge variant="secondary">
          <Trans>Balance</Trans>
        </Badge>
      );
  }
}

function ActionTable({
  title,
  headers,
  rows
}: {
  title: ReactNode;
  headers: ReactNode[];
  rows: { key: string; cells: ReactNode[] }[];
}) {
  if (rows.length === 0) return null;
  return (
    <SetupSection title={title}>
      <Table className="w-full">
        <Thead>
          <Tr>
            {headers.map((header, i) => (
              <Th key={i}>{header}</Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((row) => (
            <Tr key={row.key}>
              {row.cells.map((cell, i) => (
                <Td key={i}>{cell}</Td>
              ))}
            </Tr>
          ))}
        </Tbody>
      </Table>
    </SetupSection>
  );
}

export default function AccountImportReview({
  plan,
  rows,
  accounts,
  companies,
  targets,
  onTarget
}: AccountImportReviewProps) {
  const { t } = useLingui();
  const rowByLine = new Map(rows.map((r) => [r.line, r]));
  const rowLabel = (line: number) => {
    const row = rowByLine.get(line);
    return row ? `${row.number} ${row.name}` : String(line);
  };
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const live = new Set(companies.filter((c) => c.hasCutover).map((c) => c.id));
  const rowOptions = rows.map((r) => ({
    label: `${r.number} ${r.name}`,
    value: String(r.line)
  }));

  return (
    <>
      {plan.errors.length > 0 && (
        <Alert variant="destructive">
          <LuTriangleAlert />
          <AlertTitle>
            <Trans>Fix these in the file, then upload it again</Trans>
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {plan.errors.map((error, i) => (
                <li key={i}>
                  <PlanErrorMessage error={error} accounts={accounts} />
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {plan.exceptions.length > 0 && (
        <SetupSection
          title={<Trans>These accounts need a target</Trans>}
          description={
            <Trans>
              No row names them, but they are still in use. Pick the account in
              your chart that takes over their references, default roles and
              balance.
            </Trans>
          }
        >
          <Table className="w-full">
            <Thead>
              <Tr>
                <Th>
                  <Trans>Carbon account</Trans>
                </Th>
                <Th>
                  <Trans>Why</Trans>
                </Th>
                <Th>
                  <Trans>Companies</Trans>
                </Th>
                <Th className="w-[34%]">
                  <Trans>Merge into</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {plan.exceptions.map((exception) => (
                <Tr key={exception.accountId}>
                  <Td>{label(accounts[exception.accountId])}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {exception.reasons.map((reason) => (
                        <ReasonBadge key={reason} reason={reason} />
                      ))}
                    </div>
                  </Td>
                  <Td>
                    {exception.companyIds
                      .map((id) => companyName.get(id) ?? id)
                      .join(", ")}
                  </Td>
                  <Td>
                    <Combobox
                      size="sm"
                      options={rowOptions}
                      value={
                        targets[exception.accountId] === undefined
                          ? undefined
                          : String(targets[exception.accountId])
                      }
                      placeholder={t`Pick an account`}
                      onChange={(value) =>
                        onTarget(
                          exception.accountId,
                          value ? Number(value) : null
                        )
                      }
                    />
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </SetupSection>
      )}

      {plan.companies.length > 0 && (
        <SetupSection
          title={<Trans>Companies affected</Trans>}
          description={
            <Trans>
              The chart is shared by every company in the group. These companies
              have documents, default accounts or balances that move.
            </Trans>
          }
        >
          <Table className="w-full">
            <Thead>
              <Tr>
                <Th>
                  <Trans>Company</Trans>
                </Th>
                <Th>
                  <Trans>References moved</Trans>
                </Th>
                <Th>
                  <Trans>Default accounts moved</Trans>
                </Th>
                <Th>
                  <Trans>Reclass journals</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {plan.companies.map((company) => (
                <Tr key={company.companyId}>
                  <Td>
                    <div className="flex items-center gap-2">
                      {companyName.get(company.companyId) ?? company.companyId}
                      {live.has(company.companyId) && (
                        <Badge variant="outline">
                          <Trans>Live</Trans>
                        </Badge>
                      )}
                    </div>
                  </Td>
                  <Td>{company.repointedReferences}</Td>
                  <Td>{company.roleMoves}</Td>
                  <Td>{company.reclasses}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </SetupSection>
      )}

      <ActionTable
        title={<Trans>Renamed</Trans>}
        headers={[t`Carbon account`, t`Becomes`, t`Group`]}
        rows={plan.renames.map((r) => ({
          key: r.accountId,
          cells: [
            label(accounts[r.accountId]),
            <div key="to" className="flex items-center gap-2">
              {`${r.number} ${r.name}`}
              {r.reactivate && (
                <Badge variant="secondary">
                  <Trans>Reactivated</Trans>
                </Badge>
              )}
            </div>,
            r.group
          ]
        }))}
      />
      <ActionTable
        title={<Trans>Merged</Trans>}
        headers={[t`Carbon account`, t`Into`]}
        rows={plan.merges.map((m) => ({
          key: m.sourceId,
          cells: [label(accounts[m.sourceId]), rowLabel(m.targetLine)]
        }))}
      />
      <ActionTable
        title={<Trans>New</Trans>}
        headers={[t`Account`, t`Class`, t`Group`]}
        rows={plan.creates.map((c) => ({
          key: String(c.line),
          cells: [`${c.number} ${c.name}`, c.class, c.group]
        }))}
      />
      <ActionTable
        title={<Trans>Retired</Trans>}
        headers={[t`Carbon account`, t`How`]}
        rows={plan.retires.map((r) => ({
          key: r.accountId,
          cells: [
            label(accounts[r.accountId]),
            r.mode === "delete" ? t`Deleted` : t`Deactivated (has history)`
          ]
        }))}
      />
    </>
  );
}
