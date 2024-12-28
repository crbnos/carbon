import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Link } from "@remix-run/react";
import clsx from "clsx";
import type { IconType } from "react-icons";

import { BsBarChartFill, BsCheckLg } from "react-icons/bs";
import { FaThumbsUp } from "react-icons/fa";
import {
  AbilityEmployeeStatus,
  getTrainingStatus,
  type EmployeeAbility,
} from "~/modules/resources/types";
import { path } from "~/utils/path";

type PersonAbilitiesProps = {
  abilities: EmployeeAbility[];
};

const AbilityIcons: Record<
  AbilityEmployeeStatus,
  {
    icon: IconType;
    description: string;
  }
> = {
  [AbilityEmployeeStatus.Complete]: {
    icon: BsCheckLg,
    description: "Fully trained for",
  },
  [AbilityEmployeeStatus.InProgress]: {
    icon: BsBarChartFill,
    description: "Currently training for",
  },
  [AbilityEmployeeStatus.NotStarted]: {
    icon: FaThumbsUp,
    description: "Not started training for",
  },
};

const PersonAbilities = ({ abilities }: PersonAbilitiesProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Abilities</CardTitle>
      </CardHeader>
      <CardContent>
        {abilities?.length > 0 ? (
          <ul className="flex flex-col gap-4 w-full">
            {abilities.map((employeeAbility) => {
              const abilityStatus =
                getTrainingStatus(employeeAbility) ??
                AbilityEmployeeStatus.NotStarted;

              const { description, icon } = AbilityIcons[abilityStatus];

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
                            abilityStatus === AbilityEmployeeStatus.NotStarted,
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
                          year: "numeric",
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
            No abilities added
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PersonAbilities;
