import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  Input,
  Status,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { formatDate, toDisplayCredit, toDisplayDebit } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuCheck, LuExternalLink, LuTriangleAlert, LuX } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Link, redirect, useFetcher, useLoaderData } from "react-router";
import type {
  OpeningBalanceSection,
  OpeningBalanceValidation
} from "~/modules/accounting";
import {
  activateAccounting,
  activateAccountingValidator,
  buildOpeningBalanceProposal,
  getActivationReadiness,
  importOpeningTrialBalance,
  importTrialBalanceValidator,
  proposeOpeningBalanceValidator,
  validateOpeningBalance,
  validateOpeningBalanceValidator
} from "~/modules/accounting";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Activate Accounting`,
  to: path.to.accountingActivation
};

type DisplayLine = {
  id: string;
  accountNumber: string;
  accountName: string;
  description: string | null;
  debit: number;
  credit: number;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const readiness = await getActivationReadiness(client, companyId);
  if (readiness.error || !readiness.data) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(readiness.error, "Failed to evaluate activation readiness")
      )
    );
  }

  // The company's Draft 'Opening Balance' journal (if built yet), its lines,
  // and the current validation state.
  const journalRow = await (client.from("journal") as any)
    .select("id, status, postingDate")
    .eq("companyId", companyId)
    .eq("sourceType", "Opening Balance")
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  let lines: DisplayLine[] = [];
  let validation: OpeningBalanceValidation | null = null;
  const journal = journalRow.data as {
    id: string;
    status: string;
    postingDate: string | null;
  } | null;

  if (journal) {
    const [lineRows, validationResult] = await Promise.all([
      client
        .from("journalLine")
        .select(
          "id, amount, description, accountId, account:account!journalLine_accountId_fkey(number, name, class)"
        )
        .eq("journalId", journal.id),
      validateOpeningBalance(client, { companyId, journalId: journal.id })
    ]);

    lines = (lineRows.data ?? []).map((l) => {
      const account = Array.isArray(l.account) ? l.account[0] : l.account;
      const accountClass = account?.class as
        | Parameters<typeof toDisplayDebit>[1]
        | undefined;
      return {
        id: l.id,
        accountNumber: account?.number ?? "",
        accountName: account?.name ?? "",
        description: l.description,
        debit: accountClass
          ? toDisplayDebit(Number(l.amount), accountClass)
          : 0,
        credit: accountClass
          ? toDisplayCredit(Number(l.amount), accountClass)
          : 0
      };
    });
    validation = validationResult.data;
  }

  return { readiness: readiness.data, journal, lines, validation };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "propose") {
    const validation = await validator(proposeOpeningBalanceValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);
    const result = await buildOpeningBalanceProposal(client, {
      companyId,
      cutoverDate: validation.data.cutoverDate,
      section: validation.data.section,
      userId
    });
    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, "Failed to build proposal"))
      );
    }
    return data({}, await flash(request, success("Opening balances updated")));
  }

  if (intent === "import-tb") {
    const validation = await validator(importTrialBalanceValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);
    let rows: Array<{
      accountNumber: string;
      description?: string;
      debit: number;
      credit: number;
    }>;
    try {
      rows = JSON.parse(validation.data.rows);
    } catch {
      return data(
        {},
        await flash(request, error(null, "Trial balance could not be parsed"))
      );
    }
    const result = await importOpeningTrialBalance(client, {
      companyId,
      cutoverDate: validation.data.cutoverDate,
      rows,
      userId
    });
    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, result.error.message))
      );
    }
    return data({}, await flash(request, success("Trial balance imported")));
  }

  if (intent === "validate") {
    const validation = await validator(
      validateOpeningBalanceValidator
    ).validate(formData);
    if (validation.error) return validationError(validation.error);
    const result = await validateOpeningBalance(client, { companyId });
    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, "Failed to validate"))
      );
    }
    return data(
      {},
      await flash(request, success("Opening balances re-validated"))
    );
  }

  if (intent === "activate") {
    const validation = await validator(activateAccountingValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);
    const result = await activateAccounting(client, getDatabaseClient(), {
      companyId,
      userId,
      confirmation: validation.data.confirmation,
      cutoverDate: validation.data.cutoverDate
    });
    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, result.error.message))
      );
    }
    throw redirect(
      path.to.accountingPeriods,
      await flash(request, success("Accounting activated"))
    );
  }

  return data({}, await flash(request, error(null, "Unknown intent")));
}

const READINESS_STATUS_COLOR = {
  pass: "green",
  fail: "red",
  info: "blue"
} as const;

export default function AccountingActivationRoute() {
  const { readiness, journal, lines, validation } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();

  const [cutoverDate, setCutoverDate] = useState(
    readiness.cutoverDate ??
      (journal?.postingDate
        ? nextDay(journal.postingDate)
        : (readiness.cutoverDateOptions[0] ?? ""))
  );
  const [confirmation, setConfirmation] = useState("");

  const proposeFetcher = useFetcher<typeof action>();
  const validateFetcher = useFetcher<typeof action>();
  const activateFetcher = useFetcher<typeof action>();

  const totals = useMemo(() => {
    const debit = lines.reduce((s, l) => s + l.debit, 0);
    const credit = lines.reduce((s, l) => s + l.credit, 0);
    return { debit, credit, remaining: debit - credit };
  }, [lines]);

  if (readiness.activated) {
    return (
      <div className="p-8 max-w-4xl mx-auto w-full">
        <Alert>
          <LuCheck className="h-4 w-4" />
          <AlertTitle>
            <Trans>Accounting is activated</Trans>
          </AlertTitle>
          <AlertDescription>
            <Trans>
              Activated on{" "}
              {readiness.activatedAt ? formatDate(readiness.activatedAt) : ""}.
              The cutover date is{" "}
              {readiness.cutoverDate ? formatDate(readiness.cutoverDate) : ""}.
              Base currency and fiscal settings are now locked.
            </Trans>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const canActivate =
    readiness.ready &&
    !!validation?.allPass &&
    confirmation.trim() === readiness.companyName &&
    !!cutoverDate;

  return (
    <div className="p-8 max-w-4xl mx-auto w-full flex flex-col gap-6">
      <VStack spacing={1}>
        <Heading size="h3">
          <Trans>Activate accounting</Trans>
        </Heading>
        <p className="text-muted-foreground text-sm">
          <Trans>
            Activation is one-way. It posts an opening balance journal dated the
            day before cutover, closes every earlier period, and locks the base
            currency and fiscal calendar.
          </Trans>
        </p>
      </VStack>

      {/* Step 1 — readiness + cutover date */}
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>1. Readiness</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Every check must pass before you can activate. The cutover date
              can only fall on the first day of a fiscal period.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Check</Trans>
                </Th>
                <Th>
                  <Trans>Status</Trans>
                </Th>
                <Th>
                  <Trans>Detail</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {readiness.checks.map((check) => (
                <Tr key={check.key}>
                  <Td className="font-medium">{check.label}</Td>
                  <Td>
                    <Status color={READINESS_STATUS_COLOR[check.status]}>
                      {check.status}
                    </Status>
                  </Td>
                  <Td className="text-muted-foreground">{check.detail}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          <div className="mt-4 w-full max-w-xs">
            <label
              htmlFor="cutoverDate"
              className="text-sm font-medium block mb-1.5"
            >
              <Trans>Cutover date</Trans>
            </label>
            <select
              id="cutoverDate"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              value={cutoverDate}
              onChange={(e) => setCutoverDate(e.target.value)}
            >
              {readiness.cutoverDateOptions.map((option) => (
                <option key={option} value={option}>
                  {formatDate(option)}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Step 2 — opening balances */}
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>2. Opening balances</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Propose each section from your subledgers, or import a closing
              trial balance. Add cash, loans, and equity as journal lines until
              the entry balances.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <HStack spacing={2} className="mb-4 flex-wrap">
            {(
              [
                ["inventory", t`Inventory`],
                ["ar", t`Receivables`],
                ["ap", t`Payables`],
                ["fixedAssets", t`Fixed assets`]
              ] as Array<[OpeningBalanceSection, string]>
            ).map(([section, label]) => (
              <proposeFetcher.Form method="post" key={section}>
                <input type="hidden" name="intent" value="propose" />
                <input type="hidden" name="cutoverDate" value={cutoverDate} />
                <input type="hidden" name="section" value={section} />
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  isDisabled={!cutoverDate || proposeFetcher.state !== "idle"}
                >
                  <Trans>Propose</Trans> {label}
                </Button>
              </proposeFetcher.Form>
            ))}
            <Button variant="secondary" size="sm" asChild>
              <Link to={path.to.accountingActivationImport} prefetch="intent">
                <LuExternalLink className="mr-1 h-3.5 w-3.5" />
                <Trans>Import trial balance</Trans>
              </Link>
            </Button>
          </HStack>

          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>No opening balance lines yet.</Trans>
            </p>
          ) : (
            <>
              <Table>
                <Thead>
                  <Tr>
                    <Th>
                      <Trans>Account</Trans>
                    </Th>
                    <Th className="text-right">
                      <Trans>Debit</Trans>
                    </Th>
                    <Th className="text-right">
                      <Trans>Credit</Trans>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {lines.map((line) => (
                    <Tr key={line.id}>
                      <Td>
                        <span className="font-medium">
                          {line.accountNumber}
                        </span>{" "}
                        {line.accountName}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {line.debit ? line.debit.toFixed(2) : ""}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {line.credit ? line.credit.toFixed(2) : ""}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
              <HStack className="mt-3 justify-between text-sm">
                <span className="text-muted-foreground">
                  <Trans>Remaining to balance</Trans>
                </span>
                <Badge
                  variant={Math.abs(totals.remaining) < 0.01 ? "green" : "red"}
                >
                  {totals.remaining.toFixed(2)}
                </Badge>
              </HStack>
            </>
          )}
        </CardContent>
      </Card>

      {/* Step 3 — validation */}
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>3. Validation</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              The draft journal must balance and tie out to each subledger
              within 0.01.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {validation ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TieOutCard
                label={t`Journal balances`}
                tieOut={validation.balanced}
              />
              <TieOutCard label={t`Receivables`} tieOut={validation.arTieOut} />
              <TieOutCard label={t`Payables`} tieOut={validation.apTieOut} />
              <TieOutCard
                label={t`Inventory`}
                tieOut={validation.inventoryTieOut}
              />
              {validation.fixedAssetTieOut && (
                <TieOutCard
                  label={t`Fixed assets`}
                  tieOut={validation.fixedAssetTieOut}
                />
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              <Trans>Build the opening balances to validate.</Trans>
            </p>
          )}
          <validateFetcher.Form method="post" className="mt-4">
            <input type="hidden" name="intent" value="validate" />
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              isDisabled={!journal || validateFetcher.state !== "idle"}
            >
              <Trans>Re-validate</Trans>
            </Button>
          </validateFetcher.Form>
        </CardContent>
      </Card>

      {/* Step 4 — activate */}
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>4. Activate</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              This cannot be undone. Type the company name to confirm.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!readiness.ready && (
            <Alert variant="destructive" className="mb-4">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>
                <Trans>Not ready</Trans>
              </AlertTitle>
              <AlertDescription>
                <Trans>Resolve every failing readiness check first.</Trans>
              </AlertDescription>
            </Alert>
          )}
          <activateFetcher.Form method="post">
            <input type="hidden" name="intent" value="activate" />
            <input type="hidden" name="cutoverDate" value={cutoverDate} />
            <VStack spacing={3} className="max-w-md">
              <div className="w-full">
                <label
                  htmlFor="confirmation"
                  className="text-sm font-medium block mb-1.5"
                >
                  <Trans>Type</Trans>{" "}
                  <span className="font-semibold">{readiness.companyName}</span>{" "}
                  <Trans>to confirm</Trans>
                </label>
                <Input
                  id="confirmation"
                  name="confirmation"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder={readiness.companyName}
                />
              </div>
              <Button
                type="submit"
                isDisabled={!canActivate || activateFetcher.state !== "idle"}
                isLoading={activateFetcher.state !== "idle"}
              >
                <Trans>Activate accounting</Trans>
              </Button>
            </VStack>
          </activateFetcher.Form>
        </CardContent>
      </Card>
    </div>
  );
}

function TieOutCard({
  label,
  tieOut
}: {
  label: string;
  tieOut: OpeningBalanceValidation["balanced"];
}) {
  return (
    <div className="border rounded-md p-3 flex flex-col gap-1">
      <HStack className="justify-between">
        <span className="text-sm font-medium">{label}</span>
        {tieOut.pass ? (
          <LuCheck className="h-4 w-4 text-emerald-500" />
        ) : (
          <LuX className="h-4 w-4 text-red-500" />
        )}
      </HStack>
      <div className="text-xs text-muted-foreground flex justify-between">
        <span>
          <Trans>Draft</Trans>
        </span>
        <span className="tabular-nums">{tieOut.draftAmount.toFixed(2)}</span>
      </div>
      <div className="text-xs text-muted-foreground flex justify-between">
        <span>
          <Trans>Subledger</Trans>
        </span>
        <span className="tabular-nums">
          {tieOut.subledgerAmount.toFixed(2)}
        </span>
      </div>
      <div className="text-xs flex justify-between">
        <span className="text-muted-foreground">
          <Trans>Variance</Trans>
        </span>
        <span className="tabular-nums">{tieOut.variance.toFixed(2)}</span>
      </div>
    </div>
  );
}

// The cutover is one day after the opening journal's posting date.
function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split("T")[0];
}
