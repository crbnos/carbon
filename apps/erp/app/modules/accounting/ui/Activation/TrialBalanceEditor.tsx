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
import { LuFileUp, LuSave, LuSearch, LuTriangleAlert } from "react-icons/lu";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  usePermissions,
  useUser
} from "~/hooks";
import type { AccountListItem } from "../../types";
import { activationStepPath, useAccountsById } from "./ActivationSteps";

type Amounts = { debit: number; credit: number };

/** What the trial balance step's action returns when an import fails. */
export type TrialBalanceImportResult = { errors?: string[] };

/**
 * The prior system's trial balance as of the day before the cutover: a debit
 * and a credit per posting account, entered here or imported from a CSV with
 * the columns `accountNumber`, `debit` and `credit`. Saving replaces the
 * Draft opening journal's lines.
 */
export default function TrialBalanceEditor({
  cutoverDate,
  lines,
  controlAccountIds
}: {
  cutoverDate: string;
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
  const [edits, setEdits] = useState<Record<string, Partial<Amounts>>>({});

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
  const fileInput = useRef<HTMLInputElement>(null);

  const saved = useMemo(() => {
    const byAccount = new Map<string, Amounts>();
    for (const line of lines) {
      byAccount.set(line.accountId, { debit: line.debit, credit: line.credit });
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

  const amountsOf = (accountId: string): Amounts => {
    const stored = saved.get(accountId);
    const edit = edits[accountId];
    return {
      debit: edit?.debit ?? stored?.debit ?? 0,
      credit: edit?.credit ?? stored?.credit ?? 0
    };
  };

  const allAccountIds = new Set([...saved.keys(), ...Object.keys(edits)]);
  const entered = [...allAccountIds]
    .map((accountId) => ({ accountId, ...amountsOf(accountId) }))
    .filter((line) => line.debit !== 0 || line.credit !== 0);
  const totalDebit = round(entered.reduce((sum, line) => sum + line.debit, 0));
  const totalCredit = round(
    entered.reduce((sum, line) => sum + line.credit, 0)
  );
  const isBalanced = equals(totalDebit, totalCredit);
  const hasEdits = Object.keys(edits).length > 0;

  const setAmount = (accountId: string, side: keyof Amounts, value: number) => {
    setEdits((prev) => ({
      ...prev,
      [accountId]: {
        ...prev[accountId],
        [side]: Number.isFinite(value) ? value : 0
      }
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
            <input type="hidden" name="lines" value={JSON.stringify(entered)} />
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
        <Trans>
          The CSV needs the columns accountNumber, debit and credit. An import
          replaces the whole trial balance.
        </Trans>
      </p>

      {importErrors.length > 0 && (
        <Alert variant="destructive">
          <LuTriangleAlert className="h-4 w-4" />
          <AlertTitle>
            <Trans>The CSV was not imported</Trans>
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {importErrors.map((message) => (
                <li key={message}>{message}</li>
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
              <Trans>Debit</Trans>
            </Th>
            <Th className="w-48 text-right">
              <Trans>Credit</Trans>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {accounts.map((account) => {
            const amounts = amountsOf(account.id);
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
                {(["debit", "credit"] as const).map((side) => (
                  <Td key={side} className="text-right">
                    <NumberField
                      aria-label={
                        side === "debit"
                          ? t`Debit for ${account.name}`
                          : t`Credit for ${account.name}`
                      }
                      value={amounts[side]}
                      minValue={0}
                      step={step}
                      formatOptions={formatOptions}
                      isDisabled={!canEdit}
                      onChange={(value) => setAmount(account.id, side, value)}
                    >
                      <NumberInput
                        size="sm"
                        className="h-7 text-right font-mono tabular-nums"
                      />
                    </NumberField>
                  </Td>
                ))}
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
                  <Trans>
                    Total (out of balance by{" "}
                    {formatter.format(round(totalDebit - totalCredit))})
                  </Trans>
                </span>
              )}
            </Th>
            <Th className="text-right tabular-nums">
              {formatter.format(totalDebit)}
            </Th>
            <Th className="text-right tabular-nums">
              {formatter.format(totalCredit)}
            </Th>
          </Tr>
        </Tfoot>
      </Table>
    </div>
  );
}
