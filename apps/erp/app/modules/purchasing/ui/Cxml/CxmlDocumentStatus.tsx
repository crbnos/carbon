import { Status } from "@carbon/react";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";

type CxmlStatusValue =
  | "Received"
  | "Needs Review"
  | "Posted"
  | "Rejected"
  | "Pending"
  | "Sent"
  | "Failed";

const COLOR_MAP: Record<
  CxmlStatusValue,
  "green" | "red" | "blue" | "gray" | "orange" | "yellow"
> = {
  Received: "blue",
  "Needs Review": "yellow",
  Posted: "green",
  Rejected: "red",
  Pending: "yellow",
  Sent: "green",
  Failed: "red"
};

const LABEL_MAP: Record<CxmlStatusValue, MessageDescriptor> = {
  Received: msg`Received`,
  "Needs Review": msg`Needs Review`,
  Posted: msg`Posted`,
  Rejected: msg`Rejected`,
  Pending: msg`Pending`,
  Sent: msg`Sent`,
  Failed: msg`Failed`
};

export function CxmlDocumentStatus({ status }: { status: string }) {
  const { t } = useLingui();
  const value = status as CxmlStatusValue;
  const color = COLOR_MAP[value] ?? "gray";
  const label = LABEL_MAP[value] ? t(LABEL_MAP[value]) : status;
  return <Status color={color}>{label}</Status>;
}
