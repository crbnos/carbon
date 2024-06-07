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
import type { PartSummary } from "~/modules/items";
import { path } from "~/utils/path";

const PartHeader = () => {
  const permissions = usePermissions();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ partSummary: PartSummary }>(
    path.to.part(itemId)
  );

  const optimisticAssignment = useOptimisticAssignment({
    id: itemId,
    table: "part",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.partSummary?.assignee;

  return (
    <VStack>
      {permissions.is("employee") && !!routeData?.partSummary?.id && (
        <Menubar>
          <Assign
            id={routeData?.partSummary?.id}
            table="part"
            value={routeData?.partSummary?.assignee ?? ""}
          />
        </Menubar>
      )}
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>{routeData?.partSummary?.id}</CardTitle>
            <CardDescription>{routeData?.partSummary?.name}</CardDescription>
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
              <CardAttributeLabel>Replenishment</CardAttributeLabel>
              <CardAttributeValue>
                <Enumerable
                  value={routeData?.partSummary?.replenishmentSystem ?? null}
                />
              </CardAttributeValue>
            </CardAttribute>
            <CardAttribute>
              <CardAttributeLabel>Inventory Type</CardAttributeLabel>
              <CardAttributeValue>
                <Enumerable
                  value={routeData?.partSummary?.itemInventoryType ?? null}
                />
              </CardAttributeValue>
            </CardAttribute>
            <CardAttribute>
              <CardAttributeLabel>UoM</CardAttributeLabel>
              <CardAttributeValue>
                <Enumerable value={routeData?.partSummary?.unitOfMeasure} />
              </CardAttributeValue>
            </CardAttribute>
          </CardAttributes>
        </CardContent>
      </Card>
    </VStack>
  );
};

export default PartHeader;
