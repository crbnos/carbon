import {
  LuCalendarClock,
  LuCalendarHeart,
  LuNetwork,
  LuUsers,
} from "react-icons/lu";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { RouteGroup } from "~/types";
import { path } from "~/utils/path";

const peopleRoutes: RouteGroup[] = [
  {
    name: "Manage",
    routes: [
      {
        name: "People",
        to: path.to.people,
        icon: <LuUsers />,
        table: "employee",
      },
    ],
  },
  {
    name: "Configure",
    routes: [
      // {
      //   name: "Attributes",
      //   to: path.to.attributes,
      //   icon: <LuListChecks />,
      // },
      {
        name: "Departments",
        to: path.to.departments,
        icon: <LuNetwork />,
      },
      {
        name: "Holidays",
        to: path.to.holidays,
        icon: <LuCalendarHeart />,
      },
      {
        name: "Shifts",
        to: path.to.shifts,
        icon: <LuCalendarClock />,
      },
    ],
  },
];

export default function usePeopleSubmodules() {
  const { addSavedViewsToRoutes } = useSavedViews();

  return {
    groups: peopleRoutes.map((group) => ({
      ...group,
      routes: group.routes.map(addSavedViewsToRoutes),
    })),
  };
}
