import { getBrowserEnv } from "@carbon/auth";
import { useParams } from "react-router";
import { TableDocs, useApiDocsConfig, useSelectedLang } from "~/modules/api";

const { CARBON_API_URL } = getBrowserEnv();

export default function Route() {
  const selectedLang = useSelectedLang();
  const config = useApiDocsConfig();
  const { id } = useParams();
  if (!id) throw new Error("Table id not found");

  const endpoint = config.apiUrl || CARBON_API_URL!;
  const apiKey = config.apiKey || undefined;

  return (
    <TableDocs
      endpoint={endpoint}
      selectedLang={selectedLang}
      resourceId={id}
      apiKey={apiKey}
    />
  );
}
