// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type AccountImportCompany,
  type AccountImportError,
  type AccountImportPlan,
  type ChartImportRow,
  defaultKeyLabel
} from "@carbon/database/account-import";
import {
  Alert,
  AlertDescription,
  AlertTitle,
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

export type AccountImportAccount = { number: string | null; name: string };

type AccountImportReviewProps = {
  plan: AccountImportPlan;
  rows: ChartImportRow[];
  accounts: Record<string, AccountImportAccount>;
  companies: AccountImportCompany[];
  /** While a new plan loads: a pick then would name a line of the old file. */
  isDisabled: boolean;
  onTarget: (accountId: string, line: number | null) => void;
};

const label = (account: AccountImportAccount | undefined) =>
  account ? [account.number, account.name].filter(Boolean).join(" ") : "";

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
    case "class-type-mismatch": {
      const { line, accountType } = error;
      const accountClass = error.class;
      return (
        <Trans>
          Chart line {line}: type "{accountType}" is not a type of class{" "}
          {accountClass}.
        </Trans>
      );
    }
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
      const name = defaultKeyLabel(error.key);
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
      const name = defaultKeyLabel(error.key);
      return <Trans>{name} needs an account number.</Trans>;
    }
    case "account-has-history":
      return (
        <Trans>{account} has posted history, so it cannot be removed.</Trans>
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
  isDisabled,
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

      {plan.replacements.length > 0 && (
        <SetupSection
          title={<Trans>These accounts need a replacement</Trans>}
          description={
            <Trans>
              They are not in your chart, but documents or journals use them.
              Pick the account in your chart that replaces each one.
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
              {plan.replacements.map((replacement) => (
                <Tr key={replacement.accountId}>
                  <Td>{label(accounts[replacement.accountId])}</Td>
                  <Td>
                    {replacement.companyIds
                      .map((id) => companyName.get(id) ?? id)
                      .join(", ")}
                  </Td>
                  <Td>
                    <Combobox
                      size="sm"
                      options={rowOptions}
                      value={
                        replacement.targetLine === null
                          ? undefined
                          : String(replacement.targetLine)
                      }
                      isReadOnly={isDisabled}
                      placeholder={t`Pick an account`}
                      onChange={(value) =>
                        onTarget(
                          replacement.accountId,
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
              have documents or journals that move to another account.
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
        rows={plan.deletes.map((accountId) => ({
          key: accountId,
          cells: [label(accounts[accountId])]
        }))}
      />
    </>
  );
}
