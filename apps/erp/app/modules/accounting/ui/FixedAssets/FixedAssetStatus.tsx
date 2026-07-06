import { Status } from "@carbon/react";
import type { fixedAssetStatuses } from "../../accounting.models";

type FixedAssetStatusProps = {
  status?: (typeof fixedAssetStatuses)[number] | null;
};

const FixedAssetStatus = ({ status }: FixedAssetStatusProps) => {
  switch (status) {
    case "Draft":
      return <Status color="gray">{status}</Status>;
    case "Active":
      return <Status color="green">{status}</Status>;
    case "Fully Depreciated":
      return <Status color="yellow">{status}</Status>;
    case "Disposed":
      return <Status color="red">{status}</Status>;
    default:
      return null;
  }
};

export default FixedAssetStatus;
