import { Heading, cn } from "@carbon/react";
import { getLocalTimeZone } from "@internationalized/date";
import { useLocale } from "@react-aria/i18n";
import { Link } from "@remix-run/react";
import { useMemo, type ComponentProps } from "react";
import { LuHardHat } from "react-icons/lu";
import { useModules, useUser } from "~/hooks";
import type { Authenticated, NavItem } from "~/types";

export default function AppIndexRoute() {
  const user = useUser();
  // const permissions = usePermissions();
  const modules = useModules();
  const { locale } = useLocale();
  const date = new Date();

  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "full",
        timeZone: getLocalTimeZone(),
      }),
    [locale]
  );

  return (
    <div className="p-8 w-full h-full bg-muted">
      <Heading size="h3">Hello, {user.firstName}</Heading>
      <Subheading>{formatter.format(date)}</Subheading>
      <Hr />
      <Subheading className="mb-8">Modules</Subheading>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-6 mb-8">
        {/* {permissions.can("view", "production") && (
          <ModuleCard
            module={{
              name: "Schedule",
              to: path.to.schedule,
              icon: LuCalendarClock,
            }}
          />
        )} */}
        {modules.map((module) => (
          <ModuleCard key={module.name} module={module} />
        ))}
        <ModuleCard
          module={{
            name: "MES",
            to: "https://mes.carbonos.dev",
            icon: LuHardHat,
          }}
        />
      </div>
    </div>
  );
}

const Hr = () => (
  <hr className="h-px my-8 bg-black/10 border-0 dark:bg-white/10" />
);

const Subheading = ({ children, className }: ComponentProps<"p">) => (
  <p className={cn("text-muted-foreground text-base font-light", className)}>
    {children}
  </p>
);

const ModuleCard = ({ module }: { module: Authenticated<NavItem> }) => (
  <Link
    to={module.to}
    prefetch="intent"
    className="flex flex-col gap-3 items-center justify-center py-8 border border-border shadow-md dark:border-0 dark:shadow-[0px_1px_0px_0px_hsla(0,0%,100%,.03)_inset,0px_0px_0px_1px_hsla(0,0%,100%,.03)_inset,0px_0px_0px_1px_rgba(0,0,0,.1),0px_2px_2px_0px_rgba(0,0,0,.1),0px_4px_4px_0px_rgba(0,0,0,.1),0px_8px_8px_0px_rgba(0,0,0,.1)] bg-gradient-to-bl from-card from-50% to-background rounded-lg text-center group ring-2 ring-transparent hover:ring-white/10 cursor-pointer"
  >
    <div className="p-4 rounded-full border">
      <module.icon className="text-2xl" />
    </div>
    <span className="text-sm py-1 px-4 border border-border rounded-full group-hover:bg-accent">
      {module.name}
    </span>
  </Link>
);
