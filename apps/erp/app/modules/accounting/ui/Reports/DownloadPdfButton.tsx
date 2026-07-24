import { Button } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuFileText } from "react-icons/lu";
import { useUrlParams } from "~/hooks";
import { path } from "~/utils/path";

// Opens the financial-statements PDF (BS + IS + SCF) for the current filter set.
const DownloadPdfButton = () => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const href = path.to.file.financialStatementsPdf(params.toString());

  return (
    <Button
      variant="secondary"
      leftIcon={<LuFileText />}
      onClick={() => window.open(href, "_blank", "noopener,noreferrer")}
    >
      {t`Download PDF`}
    </Button>
  );
};

export default DownloadPdfButton;
