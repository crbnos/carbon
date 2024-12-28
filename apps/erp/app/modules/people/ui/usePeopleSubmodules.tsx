import {
  LuCalendarClock,
  LuCalendarHeart,
  LuNetwork,
  LuUsers,
} from "react-icons/lu";
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
  return { groups: peopleRoutes };
}
