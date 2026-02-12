import {
  Card,
  CardAttribute,
  CardAttributeLabel,
  CardAttributes,
  CardAttributeValue,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  useDisclosure
} from "@carbon/react";
// import { LuHistory } from "react-icons/lu";
import { useParams } from "react-router";
import { Avatar } from "~/components";
import { AuditLogDrawer } from "~/components/AuditLog";
import { useRouteData, useUser } from "~/hooks";
import { path } from "~/utils/path";
import type { EmployeeSummary } from "../../types";

const PersonHeader = () => {
  const { personId } = useParams();
  if (!personId) throw new Error("personId not found");

  const { company } = useUser();
  const auditDrawer = useDisclosure();
  const routeData = useRouteData<{ employeeSummary: EmployeeSummary }>(
    path.to.person(personId)
  );

  return (
    <>
      <Card>
        <HStack className="justify-between items-center p-6 pl-0">
          <CardHeader className="pt-0">
            <CardTitle className="text-2xl">
              {routeData?.employeeSummary?.name}
            </CardTitle>
            <CardDescription>
              {routeData?.employeeSummary?.title}
            </CardDescription>
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
      <AuditLogDrawer
        isOpen={auditDrawer.isOpen}
        onClose={auditDrawer.onClose}
        entityType="employee"
        entityId={personId}
        companyId={company.id}
      />
    </>
  );
};

export default PersonHeader;
