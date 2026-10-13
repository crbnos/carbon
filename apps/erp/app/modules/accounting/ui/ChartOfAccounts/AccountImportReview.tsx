// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  ACCOUNT_DEFAULT_COLUMNS,
  type AccountDefaultColumn,
  type AccountImportCompany,
  type AccountImportError,
  type AccountImportPlan,
  assetClassLabel,
  type ChartImportRow,
  FIXED_ASSET_CLASS_COLUMNS,
  type FixedAssetClassColumn,
  ROLE_NAMES
} from "@carbon/database/account-import";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
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
import { useRef } from "react";
import { LuFileUp, LuTriangleAlert } from "react-icons/lu";
import { SetupSection } from "~/components/Setup";
import type { AccountImportCsvError } from "../../account-import-csv";

export type AccountImportAccount = { number: string | null; name: string };

type AccountImportReviewProps = {
  plan: AccountImportPlan;
  rows: ChartImportRow[];
  accounts: Record<string, AccountImportAccount>;
  companies: AccountImportCompany[];
  targets: Record<string, number>;
  onTarget: (accountId: string, line: number | null) => void;
};

const label = (account: AccountImportAccount | undefined) =>
  account ? [account.number, account.name].filter(Boolean).join(" ") : "";

/** The name of a default accounts key: a role, or a fixed asset class account. */
function defaultLabel(key: string) {
  if ((ACCOUNT_DEFAULT_COLUMNS as readonly string[]).includes(key)) {
    return ROLE_NAMES[key as AccountDefaultColumn];
  }
  const [prefix, className, column] = key.split(":");
  if (
    prefix === "asset-class" &&
    className &&
    (FIXED_ASSET_CLASS_COLUMNS as readonly string[]).includes(column ?? "")
  ) {
    return assetClassLabel(className, column as FixedAssetClassColumn);
  }
  return key;
}

/** Picks a CSV and hands over its name and text. */
export function AccountImportFileButton({
  label,
  isLoading,
  onFile
}: {
  label: string;
  isLoading: boolean;
  onFile: (file: { name: string; text: string }) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          onFile({ name: file.name, text: await file.text() });
          if (input.current) input.current.value = "";
        }}
      />
      <Button
        leftIcon={<LuFileUp />}
        isLoading={isLoading}
        onClick={() => input.current?.click()}
      >
        {label}
      </Button>
    </>
  );
}

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
      return <Trans>Line {error.line} has no account number.</Trans>;
    case "missing-name":
      return <Trans>Line {error.line} has no account name.</Trans>;
    case "missing-group":
      return <Trans>Line {error.line} has no group.</Trans>;
    case "missing-key":
      return <Trans>Line {error.line} has no key.</Trans>;
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
  accounts,
  companies
}: {
  error: AccountImportError;
  accounts: Record<string, AccountImportAccount>;
  companies: AccountImportCompany[];
}) {
  const account = "accountId" in error ? label(accounts[error.accountId]) : "";
  switch (error.code) {
    case "accounting-activated": {
      const company =
        companies.find((c) => c.id === error.companyId)?.name ??
        error.companyId;
      return (
        <Trans>
          Accounting is set up for {company}, so the chart of accounts can no
          longer be imported.
        </Trans>
      );
    }
    case "duplicate-number": {
      const { line, firstLine, value } = error;
      return (
        <Trans>
          Chart line {line}: number {value} is already on line {firstLine}.
        </Trans>
      );
    }
    case "duplicate-name": {
      const { line, firstLine, value } = error;
      return (
        <Trans>
          Chart line {line}: name "{value}" is already on line {firstLine}.
        </Trans>
      );
    }
    case "missing-class":
      return (
        <Trans>Chart line {error.line}: a new account needs a class.</Trans>
      );
    case "group-class-mismatch": {
      const { line, group } = error;
      return (
        <Trans>
          Chart line {line}: group "{group}" holds accounts of another class.
        </Trans>
      );
    }
    case "migration-clearing-not-equity":
      return (
        <Trans>
          Chart line {error.line}: Migration Clearing must be an Equity account.
        </Trans>
      );
    case "unknown-default": {
      const { line, value } = error;
      return (
        <Trans>
          Default accounts line {line}: "{value}" is not a default account.
        </Trans>
      );
    }
    case "duplicate-default": {
      const { line, firstLine } = error;
      const name = defaultLabel(error.key);
      return (
        <Trans>
          Default accounts line {line}: {name} is already on line {firstLine}.
        </Trans>
      );
    }
    case "default-not-in-chart": {
      const { line, value } = error;
      return (
        <Trans>
          Default accounts line {line}: account {value} is not in the chart.
        </Trans>
      );
    }
    case "default-missing": {
      const name = defaultLabel(error.key);
      return <Trans>{name} needs an account number.</Trans>;
    }
    case "account-has-history":
      return (
        <Trans>
          {account} has posted journal lines, so it cannot be removed.
        </Trans>
      );
    case "target-not-in-chart":
      return (
        <Trans>
          The account picked for {account} is no longer in the chart.
        </Trans>
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
  const rowOptions = rows.map((r) => ({
    label: `${r.number} ${r.name}`,
    value: String(r.line)
  }));
  const merged = new Set(plan.merges.map((m) => m.sourceId));

  return (
    <>
      {plan.errors.length > 0 && (
        <Alert variant="destructive">
          <LuTriangleAlert />
          <AlertTitle>
            <Trans>Fix these in the files, then upload them again</Trans>
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {plan.errors.map((error, i) => (
                <li key={i}>
                  <PlanErrorMessage
                    error={error}
                    accounts={accounts}
                    companies={companies}
                  />
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {plan.exceptions.length > 0 && (
        <SetupSection
          title={<Trans>These accounts need a replacement</Trans>}
          description={
            <Trans>
              They are not in your chart, but draft documents or unposted
              journals use them. Pick the account in your chart that replaces
              each one.
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
                  <Trans>Used by</Trans>
                </Th>
                <Th className="w-[40%]">
                  <Trans>Replace with</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {plan.exceptions.map((exception) => (
                <Tr key={exception.accountId}>
                  <Td>{label(accounts[exception.accountId])}</Td>
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
              have draft documents or unposted journals that move to another
              account.
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
                  <Trans>Records moved</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {plan.companies.map((company) => (
                <Tr key={company.companyId}>
                  <Td>
                    {companyName.get(company.companyId) ?? company.companyId}
                  </Td>
                  <Td>{company.repointedReferences}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </SetupSection>
      )}

      <ActionTable
        title={<Trans>Updated</Trans>}
        headers={[t`Carbon account`, t`Becomes`, t`Group`]}
        rows={plan.updates.map((u) => ({
          key: u.accountId,
          cells: [
            label(accounts[u.accountId]),
            `${u.number} ${u.name}`,
            u.group
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
        title={<Trans>Deleted</Trans>}
        headers={[t`Carbon account`]}
        rows={plan.deletes
          .filter((accountId) => !merged.has(accountId))
          .map((accountId) => ({
            key: accountId,
            cells: [label(accounts[accountId])]
          }))}
      />
    </>
  );
}
