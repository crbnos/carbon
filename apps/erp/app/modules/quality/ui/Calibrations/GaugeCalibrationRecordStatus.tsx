import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";

type GaugeCalibrationRecordStatusProps = {
  status?: Database["public"]["Enums"]["inspectionStatus"] | null;
};

const GaugeCalibrationRecordStatus = ({
  status,
}: GaugeCalibrationRecordStatusProps) => {
  switch (status) {
    case "Pass":
      return <Status color="green">{status}</Status>;
    case "Fail":
      return <Status color="red">{status}</Status>;
    default:
      return null;
  }
};

export { GaugeCalibrationRecordStatus };
