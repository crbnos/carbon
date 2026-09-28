import type { Database } from "@carbon/database";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";

type Enums = Database["public"]["Enums"];

/** Translated labels for the AS9102 enums shown in the FAI screens. */
export function useFirstArticleLabels() {
  const { t } = useLingui();

  return useMemo(
    () => ({
      status: (value: Enums["firstArticleInspectionStatus"]) => {
        switch (value) {
          case "Draft":
            return t`Draft`;
          case "Verified":
            return t`Verified`;
          case "Approved":
            return t`Approved`;
          default:
            return value;
        }
      },
      scope: (value: Enums["firstArticleInspectionScope"]) =>
        value === "Partial" ? t`Partial` : t`Full`,
      type: (value: Enums["firstArticleInspectionType"]) =>
        value === "Assembly" ? t`Assembly` : t`Detail`,
      verification: (value: Enums["customerApprovalVerification"]) => {
        switch (value) {
          case "Yes":
            return t`Yes`;
          case "No":
            return t`No`;
          default:
            return t`N/A`;
        }
      },
      reason: (value: Enums["firstArticleInspectionReason"]) => {
        switch (value) {
          case "New Part":
            return t`New Part`;
          case "Design Change":
            return t`Design Change`;
          case "Manufacturing Source Change":
            return t`Manufacturing Source Change`;
          case "Process Change":
            return t`Process Change`;
          case "Inspection Method Change":
            return t`Inspection Method Change`;
          case "Tooling Change":
            return t`Tooling Change`;
          case "Material Change":
            return t`Material Change`;
          case "Location Change":
            return t`Location Change`;
          case "NC Program Change":
            return t`NC Program Change`;
          case "Natural or Man-made Event":
            return t`Natural or Man-made Event`;
          case "Production Lapse":
            return t`Production Lapse`;
          case "Corrective Action":
            return t`Corrective Action`;
          case "Other":
            return t`Other`;
          default:
            return value;
        }
      },
      partType: (value: "Sub-assembly" | "COTS") =>
        value === "Sub-assembly" ? t`Sub-assembly` : t`COTS`
    }),
    [t]
  );
}
