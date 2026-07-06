import { Status } from "@carbon/react";

type DepreciationRunStatusProps = {
  status?: string | null;
};

const DepreciationRunStatus = ({ status }: DepreciationRunStatusProps) => {
  switch (status) {
    case "Draft":
      return <Status color="gray">{status}</Status>;
    case "Posted":
      return <Status color="green">{status}</Status>;
    default:
      return null;
  }
};

export default DepreciationRunStatus;
