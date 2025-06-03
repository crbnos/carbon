import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";

type MakeMethodVersionStatusProps = {
  status?: Database["public"]["Enums"]["makeMethodStatus"];
  isActive: boolean;
};

const MakeMethodVersionStatus = ({
  status,
  isActive,
}: MakeMethodVersionStatusProps) => {
  switch (status) {
    case "Draft":
      return <Status color="gray">{status}</Status>;
    case "Active":
      return <Status color="green">{status}</Status>;
    case "Archived":
      return <Status color="orange">{status}</Status>;
    default:
      return null;
  }
};

export default MakeMethodVersionStatus;
