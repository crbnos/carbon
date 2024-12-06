import { getBrowserEnv } from "@carbon/auth";
import swaggerDocsSchema from "@carbon/database/swagger-docs-schema";
import { useParams } from "@remix-run/react";
import { TableDocs, useSelectedLang } from "~/modules/api";
import { snakeToCamel } from "~/utils/string";

const { SUPABASE_API_URL } = getBrowserEnv();

export const config = {
  runtime: "nodejs",
};

const functionPath = "rpc/";
const { resources } = Object.entries(swaggerDocsSchema.paths || {}).reduce(
  (a, [name]) => {
    const trimmedName = name.slice(1);
    const id = trimmedName.replace(functionPath, "");

    const displayName = id.replace(/_/g, " ");
    const camelCase = snakeToCamel(id);
    const enriched = { id, displayName, camelCase };

    if (!trimmedName.length) {
      return a;
    }

    return {
      resources: {
        ...a.resources,
        ...(!trimmedName.includes(functionPath)
          ? {
              [id]: enriched,
            }
          : {}),
      },
    };
  },
  { resources: {} }
);

export default function Route() {
  const selectedLang = useSelectedLang();
  const { id } = useParams();
  if (!id) throw new Error("Table id not found");

  return (
    <TableDocs
      endpoint={SUPABASE_API_URL}
      selectedLang={selectedLang}
      resourceId={id}
      resources={resources}
    />
  );
}
