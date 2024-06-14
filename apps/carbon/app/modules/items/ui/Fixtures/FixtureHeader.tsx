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
import {
  Assign,
  CustomerAvatar,
  EmployeeAvatar,
  useOptimisticAssignment,
} from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import type { Fixture } from "~/modules/items";
import { path } from "~/utils/path";

const FixtureHeader = () => {
  const permissions = usePermissions();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ fixtureSummary: Fixture }>(
    path.to.fixture(itemId)
  );

  const optimisticAssignment = useOptimisticAssignment({
    id: itemId,
    table: "item",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.fixtureSummary?.assignee;

  return (
    <VStack>
      {permissions.is("employee") && !!routeData?.fixtureSummary?.id && (
        <Menubar>
          <Assign
            id={itemId}
            table="item"
            value={routeData?.fixtureSummary?.assignee ?? ""}
          />
        </Menubar>
      )}
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>{routeData?.fixtureSummary?.id}</CardTitle>
            <CardDescription>{routeData?.fixtureSummary?.name}</CardDescription>
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
              <CardAttributeLabel>Inventory Type</CardAttributeLabel>
              <CardAttributeValue>
                <Enumerable
                  value={routeData?.fixtureSummary?.itemInventoryType ?? null}
                />
              </CardAttributeValue>
            </CardAttribute>
            <CardAttribute>
              <CardAttributeLabel>Customer</CardAttributeLabel>
              <CardAttributeValue>
                <CustomerAvatar
                  customerId={routeData?.fixtureSummary?.customerId ?? null}
                />
              </CardAttributeValue>
            </CardAttribute>
          </CardAttributes>
        </CardContent>
      </Card>
    </VStack>
  );
};

export default FixtureHeader;
