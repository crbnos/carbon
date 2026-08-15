import { cn } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { IconType } from "react-icons";
import {
  LuBadgeCheck,
  LuClipboardList,
  LuCog,
  LuFactory,
  LuGitBranch,
  LuLayoutDashboard,
  LuPackage,
  LuShield,
  LuTriangleAlert
} from "react-icons/lu";
import { Link, useLocation } from "react-router";
import { usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";

type ExperienceNavItem = {
  key: string;
  label: string;
  to: string;
  icon: IconType;
  permission?: string | string[];
  activePrefixes?: string[];
  placeholder?: boolean;
};

const CANONICAL_NAV_ITEMS: ExperienceNavItem[] = [
  {
    key: "overview",
    label: "Overview",
    to: path.to.authenticatedRoot,
    icon: LuLayoutDashboard
  },
  {
    key: "orders",
    label: "Orders",
    to: path.to.salesOrders,
    icon: LuClipboardList,
    permission: ["sales", "purchasing"],
    activePrefixes: ["/x/sales-order", "/x/purchase-order"]
  },
  {
    key: "production",
    label: "Production",
    to: path.to.production,
    icon: LuFactory,
    permission: "production",
    activePrefixes: ["/x/job", "/x/assembly"]
  },
  {
    key: "materials",
    label: "Materials",
    to: path.to.inventory,
    icon: LuPackage,
    permission: ["inventory", "parts"],
    activePrefixes: ["/x/part", "/x/consumable", "/x/material"]
  },
  {
    key: "quality",
    label: "Quality",
    to: path.to.quality,
    icon: LuBadgeCheck,
    permission: "quality"
  },
  {
    key: "equipment",
    label: "Equipment",
    to: path.to.resources,
    icon: LuCog,
    permission: "resources",
    activePrefixes: ["/x/maintenance"]
  },
  {
    key: "exceptions",
    label: "Exceptions",
    to: path.to.exceptions,
    icon: LuTriangleAlert,
    placeholder: true
  },
  {
    key: "decisions",
    label: "Decisions",
    to: path.to.decisions,
    icon: LuGitBranch,
    placeholder: true
  },
  {
    key: "administration",
    label: "Administration",
    to: path.to.company,
    icon: LuShield,
    permission: ["settings", "users"],
    activePrefixes: ["/x/settings", "/x/users"]
  }
];

function hasPermission(
  permission: ExperienceNavItem["permission"],
  canView: (feature: string) => boolean
) {
  if (!permission) return true;
  if (Array.isArray(permission)) return permission.some(canView);
  return canView(permission);
}

export function ExperienceShellNavigation() {
  const { t } = useLingui();
  const { pathname } = useLocation();
  const permissions = usePermissions();
  const user = useUser();

  const items = CANONICAL_NAV_ITEMS.filter(
    (item) =>
      item.placeholder ||
      hasPermission(item.permission, (feature) =>
        permissions.can("view", feature)
      )
  );

  const role = permissions.is("employee")
    ? t`Employee`
    : permissions.is("supplier")
      ? t`Supplier`
      : t`Customer`;
  const roleContext = permissions.isOwner() ? `${role} · ${t`Owner`}` : role;

  return (
    <div className="border-b bg-background px-3 sm:px-4">
      <div className="flex min-h-12 items-center gap-3">
        <Link
          to={path.to.authenticatedRoot}
          aria-label={t`Factory OS home`}
          className="hidden shrink-0 items-center gap-2 rounded-md px-2 text-sm font-semibold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
        >
          <span className="inline-flex size-6 items-center justify-center rounded-md bg-primary text-[10px] font-bold text-primary-foreground">
            FO
          </span>
          Factory OS
        </Link>
        <nav
          aria-label={t`Factory OS primary navigation`}
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-hide"
        >
          {items.map((item) => {
            const isActive =
              item.key === "overview"
                ? pathname === path.to.authenticatedRoot
                : pathname === item.to ||
                  pathname.startsWith(`${item.to}/`) ||
                  item.activePrefixes?.some((prefix) =>
                    pathname.startsWith(prefix)
                  );

            return (
              <Link
                key={item.key}
                to={item.to}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium",
                  "transition-[background-color,color] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "bg-active text-active-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <item.icon aria-hidden="true" className="size-4" />
                <span>{item.label}</span>
                {item.placeholder ? (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                    {t`P1`}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="hidden shrink-0 items-center gap-3 border-l pl-3 text-xs text-muted-foreground lg:flex">
          <span className="sr-only">{t`Role context`}</span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <LuShield aria-hidden="true" className="size-3.5" />
            {roleContext}
          </span>
          <span
            data-testid="global-object-context"
            className="whitespace-nowrap"
          >
            {t`Object: none selected`}
          </span>
          <span className="sr-only">{user.company.name}</span>
        </div>
      </div>
    </div>
  );
}

export { CANONICAL_NAV_ITEMS };
