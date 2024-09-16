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
  const formatTimeAgo = (date: Date) => {
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    const diffInDays = Math.floor(diffInSeconds / 86400);

    if (diffInDays === 0) {
      const diffInHours = Math.floor(diffInSeconds / 3600);
      if (diffInHours === 0) {
        const diffInMinutes = Math.floor(diffInSeconds / 60);
        if (diffInMinutes === 0) {
          return "just now";
        }
        return `${diffInMinutes} minute${diffInMinutes !== 1 ? "s" : ""} ago`;
      }
      return `${diffInHours} hour${diffInHours !== 1 ? "s" : ""} ago`;
    }
    if (diffInDays < 7) {
      return `${diffInDays} day${diffInDays !== 1 ? "s" : ""} ago`;
    }
    const diffInWeeks = Math.floor(diffInDays / 7);
    return `${diffInWeeks} week${diffInWeeks !== 1 ? "s" : ""} ago`;
  };
  return (
    <div className="flex items-start space-x-4">
      <EmployeeAvatar employeeId={employeeId} />
      <div className="flex-grow">
        <div className="flex items-start justify-between">
          <span className="text-gray-400">{activityMessage}</span>
          {activityIcon && <div className="mt-1 ml-4">{activityIcon}</div>}
        </div>
        <div className="text-sm text-gray-400 mt-1">
          {formatTimeAgo(new Date(activityTime))}
        </div>
      </div>
    </div>
  );
};

export default Activity;
