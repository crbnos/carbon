import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";
import {
  GAUGE_CALIBRATION_STATUS_COLOR_MAP,
  GAUGE_ROLE_COLOR_MAP,
  GAUGE_STATUS_COLOR_MAP
} from "@carbon/utils";

type GaugeStatusProps = {
  status?: Database["public"]["Enums"]["gaugeStatus"] | null;
};

const GaugeStatus = ({ status }: GaugeStatusProps) => {
  if (!status) return null;
  const color = GAUGE_STATUS_COLOR_MAP[status];
  if (!color) return null;

  return <Status color={color}>{status}</Status>;
};

type GaugeCalibrationStatusProps = {
  status?: Database["public"]["Enums"]["gaugeCalibrationStatus"] | null;
};

const GaugeCalibrationStatus = ({ status }: GaugeCalibrationStatusProps) => {
  if (!status) return null;
  const color = GAUGE_CALIBRATION_STATUS_COLOR_MAP[status];
  if (!color) return null;

  return <Status color={color}>{status}</Status>;
};

type GaugeRoleProps = {
  role?: Database["public"]["Enums"]["gaugeRole"] | null;
};

const GaugeRole = ({ role }: GaugeRoleProps) => {
  if (!role) return null;
  const color = GAUGE_ROLE_COLOR_MAP[role];
  if (!color) return null;

  return <Status color={color}>{role}</Status>;
};

export { GaugeCalibrationStatus, GaugeRole, GaugeStatus };
