import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";
import { RISK_STATUS_COLOR_MAP } from "@carbon/utils";

type RiskStatusProps = {
  status?: Database["public"]["Enums"]["riskStatus"] | null;
};

const RiskStatus = ({ status }: RiskStatusProps) => {
  if (!status) return null;
  const color = RISK_STATUS_COLOR_MAP[status];
  if (!color) return null;

  return <Status color={color}>{status}</Status>;
};

export default RiskStatus;
