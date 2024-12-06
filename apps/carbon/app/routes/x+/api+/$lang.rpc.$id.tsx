import swaggerDocsSchema from "@carbon/database/swagger-docs-schema";
import { useSelectedLang } from "~/modules/api";
import { snakeToCamel } from "~/utils/string";

export const config = {
  runtime: "nodejs",
};

const functionPath = "rpc/";
const { rpcs } = Object.entries(swaggerDocsSchema.paths || {}).reduce(
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
      rpcs: {
        ...a.rpcs,
        ...(trimmedName.includes(functionPath)
          ? {
              [id]: enriched,
            }
          : {}),
      },
    };
  },
  { rpcs: {} }
);

export default function Route() {
  const selectedLang = useSelectedLang();

  return null;
}
