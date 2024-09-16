import { formatTimeAgo } from "@carbon/utils";
import EmployeeAvatar from "./EmployeeAvatar";

type ActivityProps = {
  employeeId: string;
  activityMessage: string;
  activityTime: string;
  activityIcon?: React.ReactNode;
};

const Activity = ({
  employeeId,
  activityMessage,
  activityTime,
  activityIcon,
}: ActivityProps) => {
  return (
    <div className="flex items-start space-x-4 p-2">
      <EmployeeAvatar employeeId={employeeId} />
      <div className="flex-grow">
        <div className="flex items-start justify-between">
          <span className="text-gray-500">{activityMessage}</span>
          {activityIcon && <div className="mt-1 ml-4">{activityIcon}</div>}
        </div>
        <div className="text-sm text-gray-400 mt-1">
          {formatTimeAgo(activityTime)}
        </div>
      </div>
    </div>
  );
};

export default Activity;
