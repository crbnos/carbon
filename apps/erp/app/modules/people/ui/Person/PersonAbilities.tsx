import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";

import { Trans, useLingui } from "@lingui/react/macro";
import clsx from "clsx";
import type { IconType } from "react-icons";
import { BsBarChartFill, BsCheckLg } from "react-icons/bs";
import { FaThumbsUp } from "react-icons/fa";
import { Link } from "react-router";
import { useDateFormatter } from "~/hooks";
import type { EmployeeAbility } from "~/modules/resources/types";
import {
  AbilityEmployeeStatus,
  getTrainingStatus
} from "~/modules/resources/types";
import { path } from "~/utils/path";

type PersonAbilitiesProps = {
  abilities: EmployeeAbility[];
};

const AbilityIcons: Record<
  AbilityEmployeeStatus,
  {
    icon: IconType;
  }
> = {
  [AbilityEmployeeStatus.Complete]: {
    icon: BsCheckLg
  },
  [AbilityEmployeeStatus.InProgress]: {
    icon: BsBarChartFill
  },
  [AbilityEmployeeStatus.NotStarted]: {
    icon: FaThumbsUp
  }
};

const PersonAbilities = ({ abilities }: PersonAbilitiesProps) => {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();

  const abilityDescriptions: Record<AbilityEmployeeStatus, string> = {
    [AbilityEmployeeStatus.Complete]: t`Fully trained for`,
    [AbilityEmployeeStatus.InProgress]: t`Currently training for`,
    [AbilityEmployeeStatus.NotStarted]: t`Not started training for`
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Abilities</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {abilities?.length > 0 ? (
          <ul className="flex flex-col gap-4 w-full">
            {abilities.map((employeeAbility) => {
              const abilityStatus =
                getTrainingStatus(employeeAbility) ??
                AbilityEmployeeStatus.NotStarted;

              const { icon } = AbilityIcons[abilityStatus];
              const description = abilityDescriptions[abilityStatus];

              if (
                !employeeAbility.ability ||
                Array.isArray(employeeAbility.ability)
              ) {
                return null;
              }

              let Icon = icon;

              return (
                <li key={employeeAbility.id}>
                  <div className="grid-cols-[auto_1fr_auto] space-x-4">
                    <div
                      className={clsx(
                        "flex h-10 w-10 rounded-full items-center justify-center",
                        {
                          "bg-emerald-500 text-white":
                            abilityStatus === AbilityEmployeeStatus.Complete,
                          "bg-blue-400 text-white dark:bg-blue-500 dark:text-white":
                            abilityStatus === AbilityEmployeeStatus.InProgress,
                          "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200":
                            abilityStatus === AbilityEmployeeStatus.NotStarted
                        }
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex h-full items-center">
                      <p>
                        {description}{" "}
                        <Link
                          className="font-bold"
                          to={path.to.employeeAbility(
                            employeeAbility.ability.id,
                            employeeAbility.id
                          )}
                        >
                          {employeeAbility.ability.name}
                        </Link>
                      </p>
                    </div>
                    <div className="flex h-full items-center">
                      <p className="text-sm text-muted-foreground">
                        {formatDate(employeeAbility.lastTrainingDate, {
                          month: "short",
                          year: "numeric"
                        })}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="text-muted-foreground text-center p-4 w-full">
            <Trans>No abilities added</Trans>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PersonAbilities;
