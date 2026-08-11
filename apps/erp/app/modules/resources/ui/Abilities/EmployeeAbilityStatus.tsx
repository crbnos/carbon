import { Status } from "@carbon/react";
import { DAY_MS } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useDateFormatter } from "~/hooks";
import {
  AbilityEmployeeStatus,
  getTrainingStatus
} from "~/modules/resources/types";

const EXPIRING_SOON_DAYS = 90;

type EmployeeAbilityStatusRow = {
  active: boolean | null;
  trainingCompleted: boolean | null;
  trainingDays: number;
  lastTrainingDate: string | null;
  expiresAt: string | null;
};

type EmployeeAbilityStatusValue =
  | { kind: "inactive" }
  | { kind: "notStarted" }
  | { kind: "inTraining" }
  | { kind: "qualified" }
  | { kind: "expiring"; daysLeft: number; expiresAt: string }
  | { kind: "expired"; expiresAt: string };

export function getEmployeeAbilityStatus(
  row: EmployeeAbilityStatusRow,
  asOf: Date
): EmployeeAbilityStatusValue {
  if (!row.active) return { kind: "inactive" };

  const daysLeft = row.expiresAt
    ? Math.ceil((Date.parse(row.expiresAt) - asOf.getTime()) / DAY_MS)
    : null;

  if (daysLeft !== null && daysLeft < 0) {
    return { kind: "expired", expiresAt: row.expiresAt! };
  }

  if (row.trainingCompleted) {
    if (daysLeft !== null && daysLeft <= EXPIRING_SOON_DAYS) {
      return { kind: "expiring", daysLeft, expiresAt: row.expiresAt! };
    }
    return { kind: "qualified" };
  }

  if (getTrainingStatus(row) === AbilityEmployeeStatus.InProgress) {
    return { kind: "inTraining" };
  }

  return { kind: "notStarted" };
}

const EmployeeAbilityStatus = ({
  employeeAbility
}: {
  employeeAbility: EmployeeAbilityStatusRow;
}) => {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();

  const status = getEmployeeAbilityStatus(employeeAbility, new Date());

  switch (status.kind) {
    case "inactive":
      return (
        <Status color="gray">
          <Trans>Inactive</Trans>
        </Status>
      );
    case "notStarted":
      return (
        <Status color="gray">
          <Trans>Not Started</Trans>
        </Status>
      );
    case "inTraining":
      return (
        <Status color="orange">
          <Trans>In Training</Trans>
        </Status>
      );
    case "qualified":
      return (
        <Status color="green">
          <Trans>Qualified</Trans>
        </Status>
      );
    case "expiring":
      return (
        <Status
          color={status.daysLeft <= 30 ? "orange" : "yellow"}
          tooltip={t`Expires ${formatDate(status.expiresAt)}`}
        >
          {t`Expires in ${status.daysLeft}d`}
        </Status>
      );
    case "expired":
      return (
        <Status
          color="red"
          tooltip={t`Expired ${formatDate(status.expiresAt)}`}
        >
          <Trans>Expired</Trans>
        </Status>
      );
  }
};

export default EmployeeAbilityStatus;
