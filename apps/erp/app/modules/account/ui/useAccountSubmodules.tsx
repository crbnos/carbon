import { CgProfile } from "react-icons/cg";
import type { Route } from "~/types";
import { path } from "~/utils/path";

const accountRoutes: Route[] = [
  {
    name: "Profile",
    to: path.to.profile,
    icon: <CgProfile />,
  },
];

export default function useAccountSubmodules() {
  return { links: accountRoutes };
}
