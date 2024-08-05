import { Heading, cn } from "@carbon/react";
import { getLocalTimeZone } from "@internationalized/date";
import { useLocale } from "@react-aria/i18n";
import { Link } from "@remix-run/react";
import { useMemo, type ComponentProps } from "react";
import { useModules } from "~/components/Layout/Navigation/useModules";
import { useUser } from "~/hooks";
import type { Authenticated, NavItem } from "~/types";

export default function AppIndexRoute() {
  const user = useUser();
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
      <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
        {modules.map((module) => (
          <ModuleCard key={module.name} module={module} />
        ))}
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
    className="flex flex-col gap-6 items-center justify-center py-8 bg-gradient-to-bl from-card to-background rounded-lg shadow text-center group ring-2 ring-transparent hover:ring-white/10 cursor-pointer"
  >
    <module.icon className="text-3xl" />
    <span className="text-sm py-1 px-4 border border-border rounded-full group-hover:bg-accent">
      {module.name}
    </span>
  </Link>
);
