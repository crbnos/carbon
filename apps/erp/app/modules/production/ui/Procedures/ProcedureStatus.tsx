import { Status } from "@carbon/react";
import type { procedureStatus } from "../../production.models";

type ProcedureStatusProps = {
  status?: (typeof procedureStatus)[number] | null;
};

const ProcedureStatus = ({ status }: ProcedureStatusProps) => {
  switch (status) {
    case "Draft":
      return <Status color="gray">{status}</Status>;
    case "Active":
      return <Status color="green">{status}</Status>;
    case "Archived":
      return <Status color="red">{status}</Status>;
    default:
      return null;
  }
};

export default ProcedureStatus;
