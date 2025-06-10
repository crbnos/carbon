import { getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { Heading, cn } from "@carbon/react";
import { getLocalTimeZone } from "@internationalized/date";
import { useLocale } from "@react-aria/i18n";
import { Link } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { useMemo, type ComponentProps } from "react";
import { LuHardHat } from "react-icons/lu";
import { useModules, useUser } from "~/hooks";
import type { Authenticated, NavItem } from "~/types";

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {});
  const serviceRole = getCarbonServiceRole();

  const result = await serviceRole.functions.invoke("demand-forecast", {
    body: {
      type: "company",
      companyId,
      userId,
    },
  });

  console.log(result);
  return null;
}

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
        {modules
          .filter((mod) => mod.name !== "Settings")
          .map((module) => (
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
    className="aspect-video flex flex-col gap-3 items-center justify-center py-8  shadow-button-base bg-gradient-to-bl from-card from-50% to-background rounded-lg text-center group ring-2 ring-transparent hover:ring-white/10 cursor-pointer"
  >
    <div className="p-4 rounded-full border">
      <module.icon className="text-2xl" />
    </div>
    <span className="text-sm py-1 px-4 border border-border rounded-full group-hover:bg-accent font-medium tracking-tight">
      {module.name}
    </span>
  </Link>
);
