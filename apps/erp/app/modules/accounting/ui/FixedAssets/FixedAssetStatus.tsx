import { Status } from "@carbon/react";
import { FIXED_ASSET_STATUS_COLOR_MAP } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { fixedAssetStatuses } from "../../accounting.models";

type FixedAssetStatusProps = {
  status?: (typeof fixedAssetStatuses)[number] | null;
};

const FixedAssetStatus = ({ status }: FixedAssetStatusProps) => {
  const { t } = useLingui();
  if (!status) return null;
  const color = FIXED_ASSET_STATUS_COLOR_MAP[status];
  if (!color) return null;

  const labels: Record<(typeof fixedAssetStatuses)[number], string> = {
    Draft: t`Draft`,
    Active: t`Active`,
    "Fully Depreciated": t`Fully Depreciated`,
    Disposed: t`Disposed`
  };

  return <Status color={color}>{labels[status]}</Status>;
};

export default FixedAssetStatus;
