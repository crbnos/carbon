import {
  Badge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from "@carbon/react";
import { useEffect, useState } from "react";
import { LuClock, LuPause, LuPlay } from "react-icons/lu";
import { Link, useLocation, useSubmit } from "react-router";
import { path } from "~/utils/path";

type TimeCardButtonProps = {
  openClockEntry: {
    id: string;
    clockIn: string;
  } | null;
};

function formatElapsed(since: string) {
  const ms = Date.now() - new Date(since).getTime();
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

export function TimeCardButton({ openClockEntry }: TimeCardButtonProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  const { pathname } = useLocation();
  const submit = useSubmit();
  const [, setTick] = useState(0);

  const isClockedIn = openClockEntry !== null;

  useEffect(() => {
    if (!openClockEntry) return;
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, [openClockEntry]);

  const isOnTimeCardPage = pathname.includes("/timecard");

  function submitTimecard(intent: "clockIn" | "startBreak") {
    const formData = new FormData();
    formData.append("intent", intent);
    const action =
      intent === "startBreak" ? path.to.startBreak : path.to.timecard;

    if (intent === "startBreak") {
      formData.append("breakType", "Break");
    }

    if (isMobile) setOpenMobile(false);

    submit(formData, {
      method: "post",
      action
    });
  }

  return (
    <>
      {isClockedIn ? (
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip="Start Break"
            type="button"
            onClick={() => submitTimecard("startBreak")}
            className="font-medium"
          >
            <LuPause className="size-4" />
            <span>Start Break</span>
            {openClockEntry && (
              <Badge variant="red" className="ml-auto">
                {formatElapsed(openClockEntry.clockIn)}
              </Badge>
            )}
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : (
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip="Clock In"
            type="button"
            onClick={() => submitTimecard("clockIn")}
            className="font-medium"
          >
            <LuPlay className="size-4" />
            <span>Clock In</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      )}

      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip="My Hours"
          isActive={isOnTimeCardPage}
          asChild
        >
          <Link
            to={path.to.timeCardPage}
            onClick={() => isMobile && setOpenMobile(false)}
          >
            <LuClock />
            <span>My Hours</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </>
  );
}
