import { parseCsvFile } from "@carbon/files/csv";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  toast,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";

type CsvRow = Record<string, string>;

type ParsedRow = {
  postedDate: string;
  amount: number;
  description: string;
};

/**
 * Checkpoint 1: a fixed CSV shape (Date, Amount, Description columns) parsed
 * entirely client-side, then posted as JSON — no file storage, no
 * column-mapping UI, no OFX/BAI2/CAMT.053 yet. Those land once this loop
 * (upload -> parse -> match -> see results) is validated.
 */
function toParsedRows(rows: CsvRow[]): ParsedRow[] | null {
  const keyFor = (row: CsvRow, name: string) =>
    Object.keys(row).find((k) => k.trim().toLowerCase() === name);

  return rows
    .map((row) => {
      const dateKey = keyFor(row, "date");
      const amountKey = keyFor(row, "amount");
      const descriptionKey = keyFor(row, "description");
      if (!dateKey || !amountKey || !descriptionKey) return null;

      const amount = Number(row[amountKey]);
      if (!row[dateKey] || Number.isNaN(amount)) return null;

      return {
        postedDate: row[dateKey].trim(),
        amount,
        description: row[descriptionKey].trim()
      };
    })
    .filter((row): row is ParsedRow => row !== null);
}

type BankStatementUploadProps = {
  companyBankAccountId: string;
};

const BankStatementUpload = ({
  companyBankAccountId
}: BankStatementUploadProps) => {
  const { t } = useLingui();
  const fetcher = useFetcher<{ transactionCount: number; matched: number }>();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      toast.success(
        t`Imported ${fetcher.data.transactionCount} transactions, ${fetcher.data.matched} matched`
      );
      setFileName(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [fetcher.state, fetcher.data, t]);

  const onFileSelected = async (file: File) => {
    setFileName(file.name);
    const { rows, errors } = await parseCsvFile<CsvRow>(file);
    if (errors.length > 0) {
      toast.error(t`Failed to parse CSV file`);
      return;
    }

    const parsedRows = toParsedRows(rows);
    if (!parsedRows || parsedRows.length === 0) {
      toast.error(t`CSV must have Date, Amount, and Description columns`);
      return;
    }

    fetcher.submit(
      { fileName: file.name, rows: parsedRows },
      {
        method: "POST",
        action: path.to.bankAccountImport(companyBankAccountId),
        encType: "application/json"
      }
    );
  };

  const isImporting = fetcher.state !== "idle";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t`Import Bank Statement`}</CardTitle>
      </CardHeader>
      <CardContent>
        <VStack spacing={2}>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            disabled={isImporting}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFileSelected(file);
            }}
          />
          <p className="text-sm text-muted-foreground">
            {t`CSV with Date, Amount, and Description columns (positive amount = money in, negative = money out).`}
          </p>
          {fileName && isImporting && (
            <Button isDisabled isLoading variant="secondary" size="sm">
              {t`Importing ${fileName}...`}
            </Button>
          )}
        </VStack>
      </CardContent>
    </Card>
  );
};

export default BankStatementUpload;
