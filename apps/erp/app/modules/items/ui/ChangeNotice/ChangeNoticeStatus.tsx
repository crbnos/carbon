import { Status } from "@carbon/react";
import type { ChangeNoticeStatus as ChangeNoticeStatusType } from "../../types";

// Stage → badge color. Done is success (green); the open stages step through
// gray → blue → yellow → orange as work progresses; Cancelled is red.
const CHANGE_ORDER_STATUS_COLOR_MAP: Record<
  string,
  "green" | "orange" | "red" | "yellow" | "blue" | "gray" | "purple"
> = {
  Draft: "gray",
  Start: "blue",
  "Engineering Complete": "yellow",
  Implementation: "orange",
  Done: "green",
  Cancelled: "red"
};

type ChangeNoticeStatusProps = {
  status?: ChangeNoticeStatusType | null;
};

const ChangeNoticeStatus = ({ status }: ChangeNoticeStatusProps) => {
  if (!status) return null;
  const color = CHANGE_ORDER_STATUS_COLOR_MAP[status];
  if (!color) return null;

  return <Status color={color}>{status}</Status>;
};

export default ChangeNoticeStatus;
