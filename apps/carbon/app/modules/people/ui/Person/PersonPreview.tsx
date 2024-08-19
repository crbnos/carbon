import {
  Card,
  CardAttribute,
  CardAttributeLabel,
  CardAttributeValue,
  CardAttributes,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
} from "@carbon/react";
import { useParams } from "@remix-run/react";
import { Avatar } from "~/components";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { EmployeeSummary } from "../../types";

const PersonHeader = () => {
  const { personId } = useParams();
  if (!personId) throw new Error("personId not found");

  const routeData = useRouteData<{ employeeSummary: EmployeeSummary }>(
    path.to.person(personId)
  );

  return (
    <Card>
      <HStack className="justify-between items-center p-6 pl-0">
        <CardHeader className="pt-0">
          <CardTitle>{routeData?.employeeSummary?.name}</CardTitle>
          <CardDescription>{routeData?.employeeSummary?.title}</CardDescription>
        </CardHeader>
        <Avatar
          size="lg"
          name={routeData?.employeeSummary?.name ?? undefined}
          path={routeData?.employeeSummary?.avatarUrl}
        />
      </HStack>
      <CardContent>
        <CardAttributes>
          <CardAttribute>
            <CardAttributeLabel>Department</CardAttributeLabel>
            <CardAttributeValue>
              {routeData?.employeeSummary?.departmentName}
            </CardAttributeValue>
          </CardAttribute>
          <CardAttribute>
            <CardAttributeLabel>Location</CardAttributeLabel>
            <CardAttributeValue>
              {routeData?.employeeSummary?.locationName}
            </CardAttributeValue>
          </CardAttribute>
          <CardAttribute>
            <CardAttributeLabel>Manager</CardAttributeLabel>
            <CardAttributeValue>
              {routeData?.employeeSummary?.managerName}
            </CardAttributeValue>
          </CardAttribute>
          <CardAttribute>
            <CardAttributeLabel>Start Date</CardAttributeLabel>
            <CardAttributeValue>
              {routeData?.employeeSummary?.startDate}
            </CardAttributeValue>
          </CardAttribute>
        </CardAttributes>
      </CardContent>
    </Card>
  );
};

export default PersonHeader;
