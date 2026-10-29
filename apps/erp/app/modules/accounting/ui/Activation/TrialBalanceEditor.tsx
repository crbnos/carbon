// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TrialBalanceLine } from "@carbon/database/accounting-cutover";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  cn,
  Input,
  InputGroup,
  InputLeftElement,
  NumberField,
  NumberInput,
  Table,
  Tbody,
  Td,
  Tfoot,
  Th,
  Thead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr
} from "@carbon/react";
import { equals, INPUT_FORMAT, INPUT_STEP, round } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useRef, useState } from "react";
import {
  LuCloudDownload,
  LuFileUp,
  LuSave,
  LuSearch,
  LuTriangleAlert
} from "react-icons/lu";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  usePermissions,
  useUser
} from "~/hooks";
import type { TrialBalanceCsvError } from "../../trial-balance-csv";
import type { AccountListItem } from "../../types";
import { activationStepPath, useAccountsById } from "./ActivationSteps";

/** What the trial balance step's action returns when an import fails. */
export type TrialBalanceImportResult = { errors?: TrialBalanceCsvError[] };

/**
 * What a pull from the accounting provider returns when some of its balances
 * have no Carbon account: the rest is saved, these are left to the user.
 * `amount` is debit-signed.
 */
export type TrialBalancePullResult = {
  unplaced?: {
    code: string | null;
    name: string;
    amount: number;
    /** Mapped to more than one Carbon account. */
    ambiguous: boolean;
  }[];
};

/**
 * The prior system's trial balance as of the day before the cutover: one
 * debit-signed balance per posting account (a credit is negative), entered
 * here or imported from a CSV with the columns `accountNumber`, `debit` and
 * `credit`. Saving replaces the Draft opening journal's lines.
 */
export default function TrialBalanceEditor({
  cutoverDate,
  providerName,
  lines,
  controlAccountIds
}: {
  cutoverDate: string;
  /** The connected accounting integration that can provide a trial balance. */
  providerName: string | null;
  /** The saved trial balance. */
  lines: TrialBalanceLine[];
  /** Accounts whose opening balance Carbon posts from its open items. */
  controlAccountIds: string[];
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const formatter = useCurrencyFormatter();
  const { company } = useUser();
  const currencyDecimals = useCurrencyDecimals(company.baseCurrencyCode);
  const accountsById = useAccountsById();
  const action = activationStepPath("trial-balance", cutoverDate);
  const canEdit = permissions.can("update", "accounting");

  const [search, setSearch] = useState("");
  // Only what the user typed since the last save. The saved lines come from
  // the loader, so a reload after a save shows what was stored.
  const [edits, setEdits] = useState<Record<string, number>>({});

  const save = useAction({
    onSettled: (result) => {
      // A save that worked redirects, so it settles with no data.
      if (!result) setEdits({});
    }
  });
  const importer = useAction<TrialBalanceImportResult>({
    onSettled: (result) => {
      if (!result) setEdits({});
    }
  });
  const puller = useAction<TrialBalancePullResult>({
    // A pull that saved redirects, or returns what it could not place.
    onSettled: (result) => {
      if (!result || result.unplaced) setEdits({});
    }
  });
  const fileInput = useRef<HTMLInputElement>(null);

  const saved = useMemo(() => {
    const byAccount = new Map<string, number>();
    for (const line of lines) {
      byAccount.set(line.accountId, round(line.debit - line.credit));
    }
    return byAccount;
  }, [lines]);

  const controlAccounts = useMemo(
    () => new Set(controlAccountIds),
    [controlAccountIds]
  );

  // Every active posting account, from the accounting layout.
  const accounts = useMemo(() => {
    const list: AccountListItem[] = [...accountsById.values()];
    const sorted = list.sort((a, b) =>
      (a.number ?? "").localeCompare(b.number ?? "", undefined, {
        numeric: true
      })
    );
    const query = search.trim().toLowerCase();
    return query
      ? sorted.filter(
          (account) =>
            account.name?.toLowerCase().includes(query) ||
            account.number?.toLowerCase().includes(query)
        )
      : sorted;
  }, [accountsById, search]);

  const balanceOf = (accountId: string): number =>
    edits[accountId] ?? saved.get(accountId) ?? 0;

  const allAccountIds = new Set([...saved.keys(), ...Object.keys(edits)]);
  const entered = [...allAccountIds]
    .map((accountId) => ({ accountId, balance: balanceOf(accountId) }))
    .filter((line) => line.balance !== 0);
  // The save takes a debit and a credit per account.
  const enteredLines = entered.map(({ accountId, balance }) => ({
    accountId,
    debit: balance > 0 ? balance : 0,
    credit: balance < 0 ? -balance : 0
  }));
  const total = round(entered.reduce((sum, line) => sum + line.balance, 0));
  const isBalanced = equals(total, 0);
  const hasEdits = Object.keys(edits).length > 0;

  const setBalance = (accountId: string, value: number) => {
    setEdits((prev) => ({
      ...prev,
      [accountId]: Number.isFinite(value) ? value : 0
    }));
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const csv = await file.text();
    importer.submit(
      { intent: "import-tb", cutoverDate, csv },
      { method: "post", action }
    );
    if (fileInput.current) fileInput.current.value = "";
  };

  const formatOptions = INPUT_FORMAT.money(
    company.baseCurrencyCode,
    currencyDecimals
  );
  const step = INPUT_STEP.money(currencyDecimals);
  const importErrors = importer.data?.errors ?? [];
  const unplaced = puller.data?.unplaced ?? [];

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex w-full flex-wrap items-center justify-between gap-4">
        <InputGroup size="sm" className="w-64">
          <InputLeftElement>
            <LuSearch className="h-4 w-4 text-muted-foreground" />
          </InputLeftElement>
          <Input
            placeholder={t`Search accounts...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </InputGroup>
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          {providerName && (
            <puller.Form method="post" action={action}>
              <input type="hidden" name="intent" value="pull-tb" />
              <input type="hidden" name="cutoverDate" value={cutoverDate} />
              <Button
                type="submit"
                variant="secondary"
                leftIcon={<LuCloudDownload />}
                isDisabled={!canEdit}
                isLoading={puller.isPending}
              >
                <Trans>Pull from {providerName}</Trans>
              </Button>
            </puller.Form>
          )}
          <Button
            variant="secondary"
            leftIcon={<LuFileUp />}
            isDisabled={!canEdit}
            isLoading={importer.isPending}
            onClick={() => fileInput.current?.click()}
          >
            <Trans>Import CSV</Trans>
          </Button>
          <save.Form method="post" action={action}>
            <input type="hidden" name="intent" value="save-tb" />
            <input type="hidden" name="cutoverDate" value={cutoverDate} />
            <input
              type="hidden"
              name="lines"
              value={JSON.stringify(enteredLines)}
            />
            <Button
              type="submit"
              leftIcon={<LuSave />}
              isDisabled={!canEdit || !hasEdits}
              isLoading={save.isPending}
            >
              <Trans>Save Trial Balance</Trans>
            </Button>
          </save.Form>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {providerName ? (
          <Trans>
            Enter debits as positive and credits as negative amounts. The CSV
            needs the columns accountNumber, debit and credit. An import or a
            pull from {providerName} replaces the whole trial balance.
          </Trans>
        ) : (
          <Trans>
            Enter debits as positive and credits as negative amounts. The CSV
            needs the columns accountNumber, debit and credit. An import
            replaces the whole trial balance.
          </Trans>
        )}
      </p>

      {importErrors.length > 0 && (
        <Alert variant="destructive">
          <LuTriangleAlert className="h-4 w-4" />
          <AlertTitle>
            <Trans>The CSV was not imported</Trans>
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {importErrors.map((importError) => (
                // No two errors carry the same fields.
                <li key={JSON.stringify(importError)}>
                  <TrialBalanceCsvErrorMessage error={importError} />
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {unplaced.length > 0 && (
        <Alert variant="warning">
          <LuTriangleAlert className="h-4 w-4" />
          <AlertTitle>
            <Trans>Some balances have no Carbon account</Trans>
          </AlertTitle>
          <AlertDescription>
            <p>
              <Trans>
                Map these accounts in the {providerName} integration settings
                and pull again, or enter their balances below.
              </Trans>
            </p>
            <ul className="list-disc pl-4">
              {unplaced.map((row, index) => (
                // Two computed provider lines can share a name and no code.
                <li key={`${index}:${row.code ?? ""}:${row.name}`}>
                  {row.code ? `${row.code} ` : ""}
                  {row.name}: {formatter.format(row.amount)}
                  {row.ambiguous && (
                    <span className="text-muted-foreground">
                      {" "}
                      <Trans>(mapped to more than one Carbon account)</Trans>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Table>
        <Thead>
          <Tr>
            <Th>
              <Trans>Account</Trans>
            </Th>
            <Th className="w-48 text-right">
              <Trans>Balance</Trans>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {accounts.map((account) => {
            const balance = balanceOf(account.id);
            return (
              <Tr key={account.id}>
                <Td>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground tabular-nums">
                      {account.number}
                    </span>
                    <span>{account.name}</span>
                    {controlAccounts.has(account.id) && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Badge variant="outline">
                              <Trans>Control</Trans>
                            </Badge>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <Trans>
                            Carbon opens this account from its open items. The
                            amount here is only compared on Migration Clearing.
                          </Trans>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </Td>
                <Td className="text-right">
                  <NumberField
                    aria-label={t`Balance for ${account.name}`}
                    value={balance}
                    step={step}
                    formatOptions={formatOptions}
                    isDisabled={!canEdit}
                    onChange={(value) => setBalance(account.id, value)}
                  >
                    <NumberInput
                      size="sm"
                      className={cn(
                        "h-7 text-right tabular-nums",
                        // Most accounts carry no balance; mute the zeros.
                        balance === 0 && "text-muted-foreground"
                      )}
                    />
                  </NumberField>
                </Td>
              </Tr>
            );
          })}
        </Tbody>
        <Tfoot>
          <Tr>
            <Th>
              {isBalanced ? (
                <Trans>Total</Trans>
              ) : (
                <span className="text-destructive">
                  <Trans>Total (out of balance)</Trans>
                </span>
              )}
            </Th>
            <Th
              className={cn(
                "text-right tabular-nums",
                !isBalanced && "text-destructive"
              )}
            >
              {formatter.format(total)}
            </Th>
          </Tr>
        </Tfoot>
      </Table>
    </div>
  );
}

/** One reason a CSV was not imported, in the user's language. */
function TrialBalanceCsvErrorMessage({
  error
}: {
  error: TrialBalanceCsvError;
}) {
  switch (error.code) {
    case "empty-file":
      return <Trans>The CSV file is empty.</Trans>;
    case "missing-columns": {
      const columns = error.columns.join(", ");
      return <Trans>The CSV has no {columns} column.</Trans>;
    }
    case "missing-account-number": {
      const { line } = error;
      return <Trans>Line {line} has no account number.</Trans>;
    }
    case "invalid-amount": {
      const { line, accountNumber, value } = error;
      return error.column === "debit" ? (
        <Trans>
          Line {line} ({accountNumber}): the debit "{value}" is not a positive
          number.
        </Trans>
      ) : (
        <Trans>
          Line {line} ({accountNumber}): the credit "{value}" is not a positive
          number.
        </Trans>
      );
    }
    case "ambiguous-amount": {
      const { line, accountNumber, value } = error;
      return error.column === "debit" ? (
        <Trans>
          Line {line} ({accountNumber}): the debit "{value}" has a comma. Write
          amounts with a point for decimals and no thousands separator, such as
          1234.56.
        </Trans>
      ) : (
        <Trans>
          Line {line} ({accountNumber}): the credit "{value}" has a comma. Write
          amounts with a point for decimals and no thousands separator, such as
          1234.56.
        </Trans>
      );
    }
    case "duplicate-account": {
      const { line, firstLine, accountNumber } = error;
      return (
        <Trans>
          Line {line}: account {accountNumber} is already on line {firstLine}.
          Put each account on one line.
        </Trans>
      );
    }
    case "unknown-account": {
      const { accountNumber } = error;
      return (
        <Trans>Account {accountNumber} is not an active posting account.</Trans>
      );
    }
  }
}
