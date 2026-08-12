import { Status } from "@carbon/react";
import { DAY_MS } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useDateFormatter } from "~/hooks";

const EXPIRING_SOON_DAYS = 90;

type EmployeeAbilityStatusRow = {
  expiresAt: string | null;
};

type EmployeeAbilityStatusValue =
  | { kind: "qualified" }
  | { kind: "expiring"; daysLeft: number; expiresAt: string }
  | { kind: "expired"; expiresAt: string };

/**
 * Qualification is presence-based: an employeeAbility row means qualified,
 * subject only to expiry. A row with no expiry never expires.
 */
export function getEmployeeAbilityStatus(
  row: EmployeeAbilityStatusRow,
  asOf: Date
): EmployeeAbilityStatusValue {
  const daysLeft = row.expiresAt
    ? Math.ceil((Date.parse(row.expiresAt) - asOf.getTime()) / DAY_MS)
    : null;

  if (daysLeft !== null && daysLeft < 0) {
    return { kind: "expired", expiresAt: row.expiresAt! };
  }

  if (daysLeft !== null && daysLeft <= EXPIRING_SOON_DAYS) {
    return { kind: "expiring", daysLeft, expiresAt: row.expiresAt! };
  }

  return { kind: "qualified" };
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
