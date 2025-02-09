import { formatTimeAgo } from "@carbon/utils";
import type { ReactNode } from "react";
import { usePeople } from "~/stores";
import Avatar from "./Avatar";

type ActivityProps = {
  employeeId: string;
  activityMessage: ReactNode;
  activityTime: string;
  activityIcon?: ReactNode;
};

const Activity = ({
  employeeId,
  activityMessage,
  activityTime,
  activityIcon,
}: ActivityProps) => {
  const [people] = usePeople();
  if (!employeeId) return null;

  const person = people.find((p) => p.id === employeeId);

  return (
    <li className="relative flex-grow w-full border rounded-lg bg-card p-6 pl-14">
      <div className="absolute left-3 top-6 flex items-center justify-center w-10 h-10">
        <Avatar
          path={person?.avatarUrl ?? undefined}
          name={person?.name ?? ""}
        />
      </div>
      <div className="flex items-center space-x-2">
        <div className="flex-grow">
          <p>
            <span className="font-semibold mr-1">
              {person?.name ?? "Deactivated user"}
            </span>
            <span className="text-gray-400">{activityMessage}</span>
          </p>
          <div className="text-sm text-gray-400 mt-1">
            {formatTimeAgo(activityTime)}
          </div>
        </div>
        <div className="flex-shrink-0">{activityIcon}</div>
      </div>
    </li>
  );
};

export default Activity;
