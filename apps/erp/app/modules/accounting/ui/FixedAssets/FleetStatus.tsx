import { Status } from "@carbon/react";
import type { StatusColor } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { fleetStatuses } from "../../accounting.models";

type FleetStatusValue = (typeof fleetStatuses)[number];

// Fleet status is derived by the `fleetAssets` view, never stored, and has no
// entry in `packages/utils/src/status-colors.ts` yet, so the colours live here.
// Under Construction matches FIXED_ASSET_STATUS_COLOR_MAP so the same state
// reads the same on the asset page and in the fleet register.
const FLEET_STATUS_COLOR_MAP: Record<FleetStatusValue, StatusColor> = {
  Available: "green",
  Reserved: "yellow",
  "On Rent": "purple",
  "In Maintenance": "orange",
  "Under Construction": "blue",
  Sold: "red",
  "Returned to Stock": "gray"
};

type FleetStatusProps = {
  status?: string | null;
};

const FleetStatus = ({ status }: FleetStatusProps) => {
  const { t } = useLingui();
  if (!status) return null;
  const color = FLEET_STATUS_COLOR_MAP[status as FleetStatusValue];
  if (!color) return null;

  const labels: Record<FleetStatusValue, string> = {
    Available: t`Available`,
    Reserved: t`Reserved`,
    "On Rent": t`On Rent`,
    "In Maintenance": t`In Maintenance`,
    "Under Construction": t`Under Construction`,
    Sold: t`Sold`,
    "Returned to Stock": t`Returned to Stock`
  };

  return <Status color={color}>{labels[status as FleetStatusValue]}</Status>;
};

export default FleetStatus;
