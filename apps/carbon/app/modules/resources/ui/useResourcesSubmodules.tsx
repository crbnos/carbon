import { FaPeopleArrows } from "react-icons/fa";
import {
  LuCalendarClock,
  LuCalendarHeart,
  LuGroup,
  LuHammer,
  LuHardHat,
  LuListChecks,
  LuMapPin,
  LuNetwork,
  LuShapes,
  LuUsers,
} from "react-icons/lu";
import type { RouteGroup } from "~/types";
import { path } from "~/utils/path";

const resourcesRoutes: RouteGroup[] = [
  {
    name: "Manage",
    routes: [
      {
        name: "People",
        to: path.to.people,
        icon: <LuUsers />,
      },
      {
        name: "Contractors",
        to: path.to.contractors,
        icon: <LuHardHat />,
      },
      {
        name: "Partners",
        to: path.to.partners,
        icon: <FaPeopleArrows />,
      },
      {
        name: "Work Cells",
        to: path.to.workCells,
        icon: <LuGroup />,
      },
      {
        name: "Equipment",
        to: path.to.equipment,
        icon: <LuShapes />,
      },
    ],
  },
  {
    name: "Configure",
    routes: [
      {
        name: "Abilities",
        to: path.to.abilities,
        icon: <LuHammer />,
      },
      {
        name: "Attributes",
        to: path.to.attributes,
        icon: <LuListChecks />,
      },
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
        name: "Locations",
        to: path.to.locations,
        icon: <LuMapPin />,
      },
      {
        name: "Shifts",
        to: path.to.shifts,
        icon: <LuCalendarClock />,
      },
    ],
  },
];

export default function useResourcesSubmodules() {
  return { groups: resourcesRoutes };
}
