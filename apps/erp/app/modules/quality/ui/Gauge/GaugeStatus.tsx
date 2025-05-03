import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";

type GaugeStatusProps = {
  status?: Database["public"]["Enums"]["gaugeStatus"] | null;
};

const GaugeStatus = ({ status }: GaugeStatusProps) => {
  switch (status) {
    case "Active":
      return <Status color="gray">{status}</Status>;
    case "Inactive":
      return <Status color="red">{status}</Status>;
    default:
      return null;
  }
};

type GaugeCalibrationStatusProps = {
  status?: Database["public"]["Enums"]["gaugeCalibrationStatus"] | null;
};

const GaugeCalibrationStatus = ({ status }: GaugeCalibrationStatusProps) => {
  switch (status) {
    case "Pending":
      return <Status color="orange">{status}</Status>;
    case "In-Calibration":
      return <Status color="green">{status}</Status>;
    case "Out-of-Calibration":
      return <Status color="red">{status}</Status>;
    default:
      return null;
  }
};

type GaugeRoleProps = {
  role?: Database["public"]["Enums"]["gaugeRole"] | null;
};

const GaugeRole = ({ role }: GaugeRoleProps) => {
  switch (role) {
    case "Master":
      return <Status color="blue">{role}</Status>;
    case "Standard":
      return <Status color="gray">{role}</Status>;
    default:
      return null;
  }
};

export { GaugeCalibrationStatus, GaugeRole, GaugeStatus };
