import { LuHardHat, LuStickyNote, LuUser } from "react-icons/lu";

export function usePersonSidebar() {
  return [
    {
      name: "Profile",
      to: "details",
      icon: <LuUser />,
    },
    {
      name: "Job",
      to: "job",
      icon: <LuHardHat />,
    },
    {
      name: "Notes",
      to: "notes",
      icon: <LuStickyNote />,
    },
  ];
}
