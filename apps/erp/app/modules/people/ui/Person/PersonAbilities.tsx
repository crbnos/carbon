import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  IconButton
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCirclePlus, LuPencil } from "react-icons/lu";
import { Link, useNavigate } from "react-router";
import { DateTime } from "~/components";
import { usePermissions } from "~/hooks";
import { EmployeeAbilityStatus } from "~/modules/resources";
import type { EmployeeAbility } from "~/modules/resources/types";
import { path } from "~/utils/path";

type PersonAbilitiesProps = {
  personId: string;
  abilities: EmployeeAbility[];
};

const PersonAbilities = ({ personId, abilities }: PersonAbilitiesProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "resources");

  return (
    <Card>
      <CardHeader>
        <HStack className="w-full justify-between">
          <CardTitle>
            <Trans>Abilities</Trans>
          </CardTitle>
          {canUpdate && (
            <Button asChild variant="secondary" leftIcon={<LuCirclePlus />}>
              <Link to={path.to.newPersonAbility(personId)}>
                <Trans>Add Ability</Trans>
              </Link>
            </Button>
          )}
        </HStack>
      </CardHeader>
      <CardContent>
        {abilities?.length > 0 ? (
          <ul className="flex flex-col gap-4 w-full">
            {abilities.map((employeeAbility) => {
              if (
                !employeeAbility.ability ||
                Array.isArray(employeeAbility.ability)
              ) {
                return null;
              }

              const editPath = path.to.employeeAbility(
                employeeAbility.ability.id,
                employeeAbility.id
              );

              return (
                <li key={employeeAbility.id}>
                  <HStack className="w-full justify-between">
                    <HStack spacing={2}>
                      <Link className="font-medium" to={editPath}>
                        {employeeAbility.ability.name}
                      </Link>
                      <EmployeeAbilityStatus
                        employeeAbility={employeeAbility}
                      />
                    </HStack>
                    <HStack spacing={2}>
                      <p className="text-sm text-muted-foreground">
                        <DateTime
                          value={employeeAbility.lastTrainingDate}
                          variant="date"
                          dateOptions={{
                            month: "short",
                            year: "numeric"
                          }}
                        />
                      </p>
                      {canUpdate && (
                        <IconButton
                          aria-label={t`Edit ability`}
                          variant="ghost"
                          icon={<LuPencil />}
                          onClick={() => navigate(editPath)}
                        />
                      )}
                    </HStack>
                  </HStack>
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
