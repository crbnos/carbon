// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Company } from "@carbon/auth";
import {
  Avatar,
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  getValidChildren,
  HStack,
  PrefetchLink,
  ScrollArea,
  useIsMobile,
  useMode
} from "@carbon/react";
import type { ComponentProps } from "react";
import { cloneElement, forwardRef, useMemo } from "react";
import { LuChevronsUpDown } from "react-icons/lu";
import type { LinkProps } from "react-router";
import { Form, useMatches } from "react-router";
import { z } from "zod";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";

const BreadcrumbsBase = forwardRef<
  HTMLElement,
  ComponentProps<"nav"> & {
    useReactRouter?: boolean;
  }
>(({ className, children, useReactRouter = true, ...props }, ref) => {
  const validChildren = getValidChildren(children);
  const count = validChildren.length;
  const clones = validChildren.map((child, index) =>
    cloneElement(child, {
      isFirstChild: index === 0,
      isLastChild: index === count - 1
    })
  );
  return (
    <nav
      aria-label="Breadcrumb"
      ref={ref}
      className={cn("reset flex", className)}
      {...props}
    >
      <ol className="inline-flex items-center space-x-1">{clones}</ol>
    </nav>
  );
});
BreadcrumbsBase.displayName = "BreadcrumbsBase";

const BreadcrumbItem = forwardRef<
  HTMLLIElement,
  ComponentProps<"li"> & {
    isFirstChild?: boolean;
    isLastChild?: boolean;
  }
>(({ className, children, isFirstChild, isLastChild, ...props }, ref) => (
  <li
    ref={ref}
    className={cn("inline-flex items-center", className)}
    {...props}
  >
    {!isFirstChild && <span className="text-muted-foreground">/</span>}
    {children}
  </li>
));
BreadcrumbItem.displayName = "BreadcrumbItem";

const BreadcrumbLink = forwardRef<
  HTMLAnchorElement,
  LinkProps & {
    isCurrentPage?: boolean;
  }
>(({ className, children, isCurrentPage, ...props }, ref) => {
  return (
    <Button
      variant="ghost"
      className={cn(
        "px-2 outline-none focus-visible:ring-transparent",
        className
      )}
      asChild
    >
      {isCurrentPage ? (
        <span aria-current="page" ref={ref} {...props}>
          {children}
        </span>
      ) : (
        <PrefetchLink ref={ref} {...props}>
          {children}
        </PrefetchLink>
      )}
    </Button>
  );
});
BreadcrumbLink.displayName = "BreadcrumbLink";

export const BreadcrumbHandle = z.object({
  breadcrumb: z.any(),
  to: z.string().optional()
});
export type BreadcrumbHandleType = z.infer<typeof BreadcrumbHandle>;

const BreadcrumbHandleMatch = z.object({
  handle: BreadcrumbHandle
});

const Breadcrumbs = () => {
  const matches = useMatches();

  const breadcrumbs = matches
    .map((m) => {
      const result = BreadcrumbHandleMatch.safeParse(m);
      if (!result.success || !result.data.handle.breadcrumb) return null;

      return {
        breadcrumb: result.data.handle.breadcrumb,
        to: result.data.handle?.to ?? m.pathname
      };
    })
    .filter(Boolean);

  const isMobile = useIsMobile();

  return (
    <HStack className="items-center h-full -ml-2" spacing={0}>
      <BreadcrumbsBase className="line-clamp-1">
        {!isMobile && <CompanyBreadcrumb />}
        {breadcrumbs.map((breadcrumb, i) => (
          <BreadcrumbItem key={i}>
            <BreadcrumbLink
              isCurrentPage={!breadcrumb?.to}
              to={breadcrumb?.to ?? ""}
            >
              {breadcrumb?.breadcrumb}
            </BreadcrumbLink>
          </BreadcrumbItem>
        ))}
      </BreadcrumbsBase>
    </HStack>
  );
};

function CompanyBreadcrumb() {
  const mode = useMode();
  const routeData = useRouteData<{ company: Company; companies: Company[] }>(
    path.to.authenticatedRoot
  );

  const hasMultipleCompanies = Boolean(
    routeData?.companies && routeData?.companies.length > 1
  );

  const hasCompanyMenu = hasMultipleCompanies;

  const companyGroups = useMemo(() => {
    if (!routeData?.companies) return [];

    const groups = new Map<
      string,
      { name: string; companies: typeof routeData.companies }
    >();

    for (const c of routeData.companies) {
      const groupName = c.companyGroupName ?? "Companies";
      const existing = groups.get(groupName);
      if (existing) {
        existing.companies.push(c);
      } else {
        groups.set(groupName, { name: groupName, companies: [c] });
      }
    }

    // If a group has only one company, move it to "Companies"
    const result = new Map<
      string,
      { name: string; companies: typeof routeData.companies }
    >();
    for (const [key, group] of groups) {
      if (group.companies.length === 1 && key !== "Companies") {
        const existing = result.get("Companies");
        if (existing) {
          existing.companies.push(...group.companies);
        } else {
          result.set("Companies", {
            name: "Companies",
            companies: [...group.companies]
          });
        }
      } else {
        const existing = result.get(key);
        if (existing) {
          existing.companies.push(...group.companies);
        } else {
          result.set(key, group);
        }
      }
    }

    return Array.from(result.values());
  }, [routeData?.companies]);

  return (
    <>
      <BreadcrumbItem isFirstChild>
        <BreadcrumbLink to="/">Developers</BreadcrumbLink>
      </BreadcrumbItem>
      <BreadcrumbItem>
        {hasCompanyMenu ? (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-current="page"
                  variant="ghost"
                  className="px-2 focus-visible:ring-transparent"
                  rightIcon={<LuChevronsUpDown />}
                >
                  {routeData?.company.name}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[240px]">
                <ScrollArea className="max-h-[300px]">
                  {companyGroups.map((group, index) => (
                    <DropdownMenuGroup key={group.name}>
                      {index > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuLabel>{group.name}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {group.companies.map((c) => {
                        const logo =
                          mode === "dark" ? c.logoDarkIcon : c.logoLightIcon;
                        return (
                          <Form
                            key={c.companyId}
                            method="post"
                            action={path.to.companySwitch(c.companyId!)}
                          >
                            <DropdownMenuItem
                              className="flex items-center justify-between w-full"
                              asChild
                            >
                              <button type="submit">
                                <HStack>
                                  <Avatar
                                    size="xs"
                                    name={c.name ?? undefined}
                                    src={logo ?? undefined}
                                  />
                                  <span>{c.name}</span>
                                </HStack>
                                <Badge variant="secondary" className="ml-2">
                                  {c.employeeType}
                                </Badge>
                              </button>
                            </DropdownMenuItem>
                          </Form>
                        );
                      })}
                    </DropdownMenuGroup>
                  ))}
                </ScrollArea>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : (
          <BreadcrumbLink to="/">{routeData?.company.name}</BreadcrumbLink>
        )}
      </BreadcrumbItem>
    </>
  );
}

export default Breadcrumbs;
