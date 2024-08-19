import { BiSolidUserDetail } from "react-icons/bi";
import { CgProfile } from "react-icons/cg";
import { MdNote } from "react-icons/md";

export function usePersonSidebar() {
  return [
    {
      name: "Profile",
      to: "details",
      icon: CgProfile,
    },
    {
      name: "Job",
      to: "job",
      icon: BiSolidUserDetail,
    },
    {
      name: "Notes",
      to: "notes",
      icon: MdNote,
    },
  ];
}
