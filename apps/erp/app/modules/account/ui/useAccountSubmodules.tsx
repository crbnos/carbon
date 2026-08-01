import { useLingui } from "@lingui/react/macro";
import { CgProfile } from "react-icons/cg";
import { LuBell } from "react-icons/lu";
import type { RouteGroup } from "~/types";
import { path } from "~/utils/path";

export default function useAccountSubmodules() {
  const { t } = useLingui();
  const accountGroups: RouteGroup[] = [
    {
      name: t`Account`,
      routes: [
        {
          name: t`Profile`,
          to: path.to.profile,
          icon: <CgProfile />
        },
        {
          name: t`Notifications`,
          to: path.to.notificationSettings,
          icon: <LuBell />
        }
      ]
    }
  ];
  return { groups: accountGroups };
}
