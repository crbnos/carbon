import { useLingui } from "@lingui/react/macro";
import {
  LuClock,
  LuGraduationCap,
  LuHardHat,
  LuList,
  LuStickyNote,
  LuUser
} from "react-icons/lu";
import type { PublicAttributes } from "~/modules/account";

export function usePersonSidebar(
  attributeCategories: PublicAttributes[],
  timeCardEnabled?: boolean
) {
  const { t } = useLingui();
  const baseLinks = [
    {
      name: t`Profile`,
      to: "details",
      icon: <LuUser />
    },
    {
      name: t`Job`,
      to: "job",
      icon: <LuHardHat />
    },
    {
      name: t`Abilities`,
      to: "abilities",
      icon: <LuGraduationCap />
    },
    {
      name: t`Notes`,
      to: "notes",
      icon: <LuStickyNote />
    },
    ...(timeCardEnabled
      ? [
          {
            name: t`Timecards`,
            to: "timecard",
            icon: <LuClock />
          }
        ]
      : [])
  ];

  const categoryLinks = attributeCategories.map((category) => ({
    name: category.name ?? t`Attributes`,
    to: `attributes/${category.id}`,
    icon: category.emoji ? (
      <span className="text-base">{category.emoji}</span>
    ) : (
      <LuList />
    )
  }));

  return [...baseLinks, ...categoryLinks];
}
