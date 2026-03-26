import {
  Badge,
  SidebarMenuButton,
  SidebarMenuItem,
  toast,
  useSidebar
} from "@carbon/react";
import { useEffect, useState } from "react";
import { LuClock, LuPause, LuPlay } from "react-icons/lu";
import { Link, useFetcher, useLocation, useRevalidator } from "react-router";
import { path } from "~/utils/path";

type TimeCardButtonProps = {
  openClockEntry: {
    id: string;
    clockIn: string;
  } | null;
  openBreak: {
    id: string;
    startTime: string;
    breakType?: string | null;
  } | null;
};

function formatElapsed(since: string) {
  const ms = Date.now() - new Date(since).getTime();
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

export function TimeCardButton({
  openClockEntry,
  openBreak
}: TimeCardButtonProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  const { pathname } = useLocation();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const revalidator = useRevalidator();
  const [, setTick] = useState(0);

  const isClockedIn = openClockEntry !== null;
  const isOnBreak = openBreak !== null;

  useEffect(() => {
    if (!openClockEntry) return;
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, [openClockEntry]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;

    if (fetcher.data.success) {
      revalidator.revalidate();
      return;
    }

    if (fetcher.data.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.data, fetcher.state, revalidator]);

  const isOnTimeCardPage = pathname.includes("/timecard");

  function submitTimecard(
    intent: "clockIn" | "startBreak" | "resumeFromBreak"
  ) {
    const formData = new FormData();
    formData.append("intent", intent);
    const action =
      intent === "startBreak" ? path.to.startBreak : path.to.timeCardPage;

    if (intent === "startBreak") {
      formData.append("breakType", "Break");
    }

    if (isMobile) setOpenMobile(false);

    fetcher.submit(formData, {
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
      ) : isOnBreak ? (
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip="Resume Paid Work"
            type="button"
            onClick={() => submitTimecard("resumeFromBreak")}
            className="font-medium"
          >
            <LuPlay className="size-4" />
            <span>Resume Paid Work</span>
            {openBreak && (
              <Badge variant="yellow" className="ml-auto">
                {openBreak.breakType ?? "Break"}
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
