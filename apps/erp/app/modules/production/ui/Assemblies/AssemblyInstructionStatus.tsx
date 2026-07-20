import { Status } from "@carbon/react";
import type { assemblyInstructionStatuses } from "../../production.models";

type AssemblyInstructionStatusProps = {
  status?: (typeof assemblyInstructionStatuses)[number] | null;
};

const AssemblyInstructionStatus = ({
  status
}: AssemblyInstructionStatusProps) => {
  switch (status) {
    case "Draft":
      return <Status color="gray">{status}</Status>;
    case "Published":
      return <Status color="green">{status}</Status>;
    case "Archived":
      return <Status color="red">{status}</Status>;
    default:
      return null;
  }
};

export default AssemblyInstructionStatus;
