import { cn } from "@carbon/react";
import type { ReactNode } from "react";
import { useDateFormatter, useHighlightFlash } from "~/hooks";
import { usePeople } from "~/stores";
import Avatar from "./Avatar";

type Person = { id: string; name: string; avatarUrl: string | null };

// Build (and cache) an id→person Map keyed on the people array's identity. The
// nanostore hands back a stable reference until the roster changes, so every
// Activity row shares one O(1) lookup instead of each doing an O(n) `find`.
const peopleByIdCache = new WeakMap<object, Map<string, Person>>();
function peopleById(people: readonly Person[]) {
  let map = peopleByIdCache.get(people);
  if (!map) {
    map = new Map(people.map((person) => [person.id, person]));
    peopleByIdCache.set(people, map);
  }
  return map;
}

type ActivityProps = {
  employeeId: string;
  activityMessage: ReactNode;
  activityTime: string;
  activityIcon?: ReactNode;
  comment?: string | null;
  highlighted?: boolean;
};

const Activity = ({
  employeeId,
  activityMessage,
  activityTime,
  activityIcon,
  comment,
  highlighted = false
}: ActivityProps) => {
  const { formatTimeAgo } = useDateFormatter();
  const [people] = usePeople();
  const { ref, isFlashing } = useHighlightFlash<HTMLLIElement>(highlighted);

  if (!employeeId) return null;

  const person = peopleById(people).get(employeeId);

  return (
    <li
      ref={ref}
      className={cn(
        "relative flex-grow w-full border rounded-lg bg-card p-6 pl-14 transition-colors duration-150",
        isFlashing && "bg-accent"
      )}
    >
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
              {person?.name ?? "Carbon Admin"}
            </span>
            <span className="text-muted-foreground">{activityMessage}</span>
          </p>
          {comment && (
            <p className="text-sm text-muted-foreground mt-1 italic">
              {comment}
            </p>
          )}
          <div className="text-sm text-muted-foreground mt-1">
            {formatTimeAgo(activityTime)}
          </div>
        </div>
        <div className="flex-shrink-0">{activityIcon}</div>
      </div>
    </li>
  );
};

export default Activity;
