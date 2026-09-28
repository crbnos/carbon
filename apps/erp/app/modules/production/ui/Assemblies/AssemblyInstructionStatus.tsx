import { Status } from "@carbon/react";
import { ASSEMBLY_INSTRUCTION_STATUS_COLOR_MAP } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { assemblyInstructionStatuses } from "../../production.models";

type AssemblyInstructionStatusProps = {
  status?: (typeof assemblyInstructionStatuses)[number] | null;
};

const AssemblyInstructionStatus = ({
  status
}: AssemblyInstructionStatusProps) => {
  const { t } = useLingui();
  switch (status) {
    case "Draft":
      return (
        <Status
          color={ASSEMBLY_INSTRUCTION_STATUS_COLOR_MAP.Draft}
        >{t`Draft`}</Status>
      );
    case "Published":
      return (
        <Status color={ASSEMBLY_INSTRUCTION_STATUS_COLOR_MAP.Published}>
          {t`Published`}
        </Status>
      );
    case "Archived":
      return (
        <Status color={ASSEMBLY_INSTRUCTION_STATUS_COLOR_MAP.Archived}>
          {t`Archived`}
        </Status>
      );
    default:
      return null;
  }
};

export default AssemblyInstructionStatus;
