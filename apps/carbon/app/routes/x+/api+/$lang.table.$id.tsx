import { getBrowserEnv } from "@carbon/auth";
import { useParams } from "@remix-run/react";
import { TableDocs, useSelectedLang } from "~/modules/api";

const { SUPABASE_API_URL } = getBrowserEnv();

export const config = {
  runtime: "nodejs",
};

export default function Route() {
  const selectedLang = useSelectedLang();
  const { id } = useParams();
  if (!id) throw new Error("Table id not found");

  return (
    <TableDocs
      endpoint={SUPABASE_API_URL}
      selectedLang={selectedLang}
      resourceId={id}
    />
  );
}
