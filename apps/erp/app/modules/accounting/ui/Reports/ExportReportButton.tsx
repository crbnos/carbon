import { Button } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { json2csv } from "json-2-csv";
import { useCallback } from "react";
import { LuDownload } from "react-icons/lu";

type ExportReportButtonProps = {
  rows: Record<string, string | number | null>[];
  filename: string;
};

// Standalone CSV export for the statement reports (the tree/section screens that
// don't ride the shared Table). Mirrors the ExchangeRateForm download mechanics.
const ExportReportButton = ({ rows, filename }: ExportReportButtonProps) => {
  const { t } = useLingui();

  const onExport = useCallback(() => {
    if (!rows.length) return;
    const csvData = json2csv(rows, { emptyFieldValue: "" });
    const blob = new Blob([csvData], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, [rows, filename]);

  return (
    <Button
      variant="secondary"
      leftIcon={<LuDownload />}
      onClick={onExport}
      isDisabled={!rows.length}
    >
      {t`Export CSV`}
    </Button>
  );
};

export default ExportReportButton;
