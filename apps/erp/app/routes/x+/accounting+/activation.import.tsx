import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import Papa from "papaparse";
import { useEffect, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData, useNavigate } from "react-router";
import { getActivationReadiness } from "~/modules/accounting";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Import Trial Balance`,
  to: path.to.accountingActivationImport
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const readiness = await getActivationReadiness(client, companyId);
  if (readiness.error || !readiness.data || readiness.data.activated) {
    throw redirect(
      path.to.accountingActivation,
      await flash(
        request,
        error(readiness.error, "Activation is not available")
      )
    );
  }

  return {
    cutoverDateOptions: readiness.data.cutoverDateOptions,
    defaultCutoverDate:
      readiness.data.cutoverDate ?? readiness.data.cutoverDateOptions[0] ?? ""
  };
}

type ParsedRow = {
  accountNumber: string;
  description?: string;
  debit: number;
  credit: number;
};

// Case-insensitive lookup of the columns we care about.
function pick(row: Record<string, string>, keys: string[]): string | undefined {
  const lower = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v])
  );
  for (const key of keys) {
    const value = lower[key];
    if (value != null && value !== "") return value;
  }
  return undefined;
}

export default function ActivationImportRoute() {
  const { cutoverDateOptions, defaultCutoverDate } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  const [cutoverDate, setCutoverDate] = useState(defaultCutoverDate);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  const onFile = (file: File | null) => {
    if (!file) return;
    setParseError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      error: (err) => setParseError(err.message),
      complete: (results) => {
        const parsed: ParsedRow[] = [];
        for (const raw of results.data) {
          const accountNumber = pick(raw, [
            "accountnumber",
            "account",
            "number"
          ]);
          if (!accountNumber) continue;
          parsed.push({
            accountNumber: accountNumber.trim(),
            description: pick(raw, ["description", "name", "memo"]),
            debit: Number(pick(raw, ["debit"]) ?? 0) || 0,
            credit: Number(pick(raw, ["credit"]) ?? 0) || 0
          });
        }
        if (parsed.length === 0) {
          setParseError(t`No account rows found in the file.`);
        }
        setRows(parsed);
      }
    });
  };

  // Return to the wizard once the import action completes successfully.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data !== undefined) {
      navigate(path.to.accountingActivation);
    }
  }, [fetcher.state, fetcher.data, navigate]);

  const isBusy = fetcher.state !== "idle";

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) navigate(path.to.accountingActivation);
      }}
    >
      <ModalContent size="medium">
        <fetcher.Form method="post" action={path.to.accountingActivation}>
          <ModalHeader>
            <ModalTitle>
              <Trans>Import closing trial balance</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Upload a CSV with account number, description, debit, and credit
                columns. Rows map to Carbon accounts by number.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <input type="hidden" name="intent" value="import-tb" />
            <input type="hidden" name="cutoverDate" value={cutoverDate} />
            <input type="hidden" name="rows" value={JSON.stringify(rows)} />
            <VStack spacing={3}>
              <div className="w-full">
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
                  {cutoverDateOptions.map((option) => (
                    <option key={option} value={option}>
                      {formatDate(option)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-full">
                <label
                  htmlFor="tbFile"
                  className="text-sm font-medium block mb-1.5"
                >
                  <Trans>Trial balance CSV</Trans>
                </label>
                <input
                  id="tbFile"
                  type="file"
                  accept=".csv,text/csv"
                  className="text-sm"
                  onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                />
              </div>
              {parseError && (
                <p className="text-sm text-red-500">{parseError}</p>
              )}
              {rows.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {rows.length} {t`rows parsed`}
                </p>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button
              type="submit"
              isLoading={isBusy}
              isDisabled={rows.length === 0 || !cutoverDate || isBusy}
            >
              <Trans>Import</Trans>
            </Button>
          </ModalFooter>
        </fetcher.Form>
      </ModalContent>
    </Modal>
  );
}
