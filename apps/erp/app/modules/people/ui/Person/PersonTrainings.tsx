import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuCircleCheck, LuClock, LuTriangleAlert } from "react-icons/lu";
import { Link } from "react-router";
import { DateTime } from "~/components";
import type { TrainingAssignmentStatusItem } from "~/modules/resources/types";
import { path } from "~/utils/path";

type PersonTrainingsProps = {
  trainings: TrainingAssignmentStatusItem[];
};

function TrainingStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "Completed":
      return (
        <Badge variant="green">
          <LuCircleCheck className="mr-1" />
          <Trans>Completed</Trans>
        </Badge>
      );
    case "Pending":
      return (
        <Badge variant="secondary">
          <LuClock className="mr-1" />
          <Trans>Pending</Trans>
        </Badge>
      );
    case "Overdue":
      return (
        <Badge variant="red">
          <LuTriangleAlert className="mr-1" />
          <Trans>Overdue</Trans>
        </Badge>
      );
    case "Not Required":
      return (
        <Badge variant="outline">
          <Trans>Not Required</Trans>
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

const PersonTrainings = ({ trainings }: PersonTrainingsProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Trainings</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {trainings.length > 0 ? (
          <ul className="flex flex-col gap-4 w-full">
            {trainings.map((training) => (
              <li key={training.trainingAssignmentId}>
                <HStack className="w-full justify-between">
                  <HStack spacing={2}>
                    <Link
                      className="font-medium"
                      to={path.to.trainingAssignmentDetail(training.trainingId)}
                    >
                      {training.trainingName}
                    </Link>
                    <TrainingStatusBadge status={training.status} />
                  </HStack>
                  {training.completedAt && (
                    <p className="text-sm text-muted-foreground">
                      <DateTime
                        value={training.completedAt}
                        variant="date"
                        dateOptions={{
                          month: "short",
                          year: "numeric"
                        }}
                      />
                    </p>
                  )}
                </HStack>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-muted-foreground text-center p-4 w-full">
            <Trans>No trainings assigned</Trans>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PersonTrainings;
