import { Status } from "@carbon/react";
import { FIXED_ASSET_STATUS_COLOR_MAP } from "@carbon/utils";
import type { fixedAssetStatuses } from "../../accounting.models";

type FixedAssetStatusProps = {
  status?: (typeof fixedAssetStatuses)[number] | null;
};

const FixedAssetStatus = ({ status }: FixedAssetStatusProps) => {
  if (!status) return null;
  const color = FIXED_ASSET_STATUS_COLOR_MAP[status];
  if (!color) return null;

  return <Status color={color}>{status}</Status>;
};

export default FixedAssetStatus;
