import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuIcon,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import {
  LuCalendar,
  LuCalendarDays,
  LuChartNoAxesGantt,
  LuChevronDown,
  LuCog,
  LuFactory,
  LuList,
  LuUsers
} from "react-icons/lu";
import { useLocation, useNavigate } from "react-router";
import { path } from "~/utils/path";

export function ScheduleNavigation() {
  const location = useLocation();
  const navigate = useNavigate();

  const getCurrentView = () => {
    if (location.pathname.includes(path.to.schedulePeople)) return "people";
    if (location.pathname.includes(path.to.scheduleResources))
      return "capacity";
    if (location.pathname.includes(path.to.scheduleGantt())) return "timeline";
    if (location.pathname.includes(path.to.scheduleOperation))
      return "operations";
    if (location.pathname.includes(path.to.scheduleDates)) {
      if (location.search.includes("view=month")) {
        return "month";
      }
      // Default to week for scheduleDates path (whether view=week or no view param)
      return "week";
    }
    return "operations";
  };

  const currentValue = getCurrentView();

  const getViewLabel = (option: string) => {
    switch (option) {
      case "operations":
        return "Work Centers";
      case "capacity":
        return "Capacity";
      case "people":
        return "People";
      case "week":
        return "Week";
      case "month":
        return "Month";
      case "timeline":
        return "Timeline";
      default:
        return "";
    }
  };

  const getViewIcon = (option: string) => {
    switch (option) {
      case "operations":
        return <LuCog />;
      case "capacity":
        return <LuFactory />;
      case "people":
        return <LuUsers />;
      case "week":
        return <LuCalendarDays />;
      case "month":
        return <LuCalendar />;
      case "timeline":
        return <LuChartNoAxesGantt />;
      default:
        return <LuList />;
    }
  };

  const navigateToView = (view: string) => {
    const searchParams = new URLSearchParams(location.search);

    switch (view) {
      case "operations":
        navigate(path.to.scheduleOperation + "?" + searchParams.toString());
        break;
      case "capacity":
        navigate(path.to.scheduleResources);
        break;
      case "people":
        navigate(path.to.schedulePeople + "?" + searchParams.toString());
        break;
      case "week":
        searchParams.set("view", "week");
        navigate(path.to.scheduleDates + "?" + searchParams.toString());
        break;
      case "month":
        searchParams.set("view", "month");
        navigate(path.to.scheduleDates + "?" + searchParams.toString());
        break;
      case "timeline":
        navigate(path.to.scheduleGantt());
        break;
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          leftIcon={getViewIcon(currentValue)}
          rightIcon={<LuChevronDown />}
          variant="secondary"
        >
          {getViewLabel(currentValue)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuRadioGroup
          value={currentValue}
          onValueChange={navigateToView}
        >
          <DropdownMenuLabel>
            <Trans>Operations</Trans>
          </DropdownMenuLabel>
          <DropdownMenuRadioItem value="operations">
            <DropdownMenuIcon icon={getViewIcon("operations")} />
            {getViewLabel("operations")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="capacity">
            <DropdownMenuIcon icon={getViewIcon("capacity")} />
            {getViewLabel("capacity")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="people">
            <DropdownMenuIcon icon={getViewIcon("people")} />
            {getViewLabel("people")}
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <Trans>Jobs</Trans>
            </DropdownMenuLabel>
            <DropdownMenuRadioItem value="week">
              <DropdownMenuIcon icon={getViewIcon("week")} />
              {getViewLabel("week")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="month">
              <DropdownMenuIcon icon={getViewIcon("month")} />
              {getViewLabel("month")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="timeline">
              <DropdownMenuIcon icon={getViewIcon("timeline")} />
              {getViewLabel("timeline")}
            </DropdownMenuRadioItem>
          </DropdownMenuGroup>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
