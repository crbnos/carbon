import {
  Card,
  CardAction,
  CardAttribute,
  CardAttributeLabel,
  CardAttributeValue,
  CardAttributes,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Enumerable,
  HStack,
  Menubar,
  VStack,
} from "@carbon/react";

import { useParams } from "@remix-run/react";
import { Assign, EmployeeAvatar, useOptimisticAssignment } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import type { Material } from "~/modules/items";
import { path } from "~/utils/path";

const MaterialHeader = () => {
  const permissions = usePermissions();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ materialSummary: Material }>(
    path.to.material(itemId)
  );

  const optimisticAssignment = useOptimisticAssignment({
    id: itemId,
    table: "item",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.materialSummary?.assignee;

  return (
    <VStack>
      {permissions.is("employee") && !!routeData?.materialSummary?.id && (
        <Menubar>
          <Assign
            id={itemId}
            table="item"
            value={routeData?.materialSummary?.assignee ?? ""}
          />
        </Menubar>
      )}
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>{routeData?.materialSummary?.id}</CardTitle>
            <CardDescription>
              {routeData?.materialSummary?.name}
            </CardDescription>
          </CardHeader>
          <CardAction>
            {/* <Button
            variant="secondary"
            onClick={() => alert("TODO")}
            leftIcon={<FaHistory />}
          >
            View History
          </Button> */}
          </CardAction>
        </HStack>
        <CardContent>
          <CardAttributes>
            <CardAttribute>
              <CardAttributeLabel>Assignee</CardAttributeLabel>
              <CardAttributeValue>
                {assignee ? (
                  <EmployeeAvatar employeeId={assignee ?? null} />
                ) : (
                  "-"
                )}
              </CardAttributeValue>
            </CardAttribute>
            <CardAttribute>
              <CardAttributeLabel>Form</CardAttributeLabel>
              <CardAttributeValue>
                <Enumerable
                  value={routeData?.materialSummary?.materialForm ?? null}
                />
              </CardAttributeValue>
            </CardAttribute>
            <CardAttribute>
              <CardAttributeLabel>Substance</CardAttributeLabel>
              <CardAttributeValue>
                <Enumerable
                  value={routeData?.materialSummary?.materialSubstance ?? null}
                />
              </CardAttributeValue>
            </CardAttribute>
            <CardAttribute>
              <CardAttributeLabel>Finish</CardAttributeLabel>
              <CardAttributeValue>
                <Enumerable
                  value={routeData?.materialSummary?.finish ?? null}
                />
              </CardAttributeValue>
            </CardAttribute>
            <CardAttribute>
              <CardAttributeLabel>Grade</CardAttributeLabel>
              <CardAttributeValue>
                <Enumerable value={routeData?.materialSummary?.grade ?? null} />
              </CardAttributeValue>
            </CardAttribute>
            <CardAttribute>
              <CardAttributeLabel>UoM</CardAttributeLabel>
              <CardAttributeValue>
                <Enumerable
                  value={routeData?.materialSummary?.unitOfMeasure ?? null}
                />
              </CardAttributeValue>
            </CardAttribute>
          </CardAttributes>
        </CardContent>
      </Card>
    </VStack>
  );
};

export default MaterialHeader;
