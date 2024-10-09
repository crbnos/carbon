import type { Company } from "@carbon/auth";
import {
  Avatar,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  useWindowSize,
} from "@carbon/react";
import { Form, Link, useMatches } from "@remix-run/react";
import { BsFillHexagonFill } from "react-icons/bs";
import { LuChevronsUpDown } from "react-icons/lu";
import { z } from "zod";
import {
  BreadcrumbItem,
  BreadcrumbLink,
  Breadcrumbs as BreadcrumbsBase,
} from "~/components/Breadcrumbs";

import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";

export const BreadcrumbHandle = z.object({
  breadcrumb: z.any(),
  to: z.string().optional(),
});
export type BreadcrumbHandleType = z.infer<typeof BreadcrumbHandle>;

const BreadcrumbHandleMatch = z.object({
  handle: BreadcrumbHandle,
});

const Breadcrumbs = () => {
  const matches = useMatches();

  const breadcrumbs = matches
    .map((m) => {
      const result = BreadcrumbHandleMatch.safeParse(m);
      if (!result.success || !result.data.handle.breadcrumb) return null;

      return {
        breadcrumb: result.data.handle.breadcrumb,
        to: result.data.handle?.to ?? m.pathname,
      };
    })
    .filter(Boolean);

  const { width } = useWindowSize();

  return (
    <HStack className="items-center h-full -ml-2" spacing={0}>
      <BreadcrumbsBase className="line-clamp-1">
        {width && width <= 640 ? (
          <BreadcrumbItem>
            <Button isIcon asChild variant="ghost">
              <Link to="/">
                <BsFillHexagonFill />
              </Link>
            </Button>
          </BreadcrumbItem>
        ) : (
          <CompanyBreadcrumb />
        )}
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
  const routeData = useRouteData<{ company: Company; companies: Company[] }>(
    path.to.authenticatedRoot
  );

  const hasMultipleCompanies = Boolean(
    routeData?.companies && routeData?.companies.length > 1
  );

  const hasCompanyMenu = hasMultipleCompanies;

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
                <DropdownMenuLabel>Companies</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  {routeData?.companies.map((c) => (
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
                              src={c.logo ?? undefined}
                            />
                            <span>{c.name}</span>
                          </HStack>
                          <Badge variant="secondary" className="ml-2">
                            {c.employeeType}
                          </Badge>
                        </button>
                      </DropdownMenuItem>
                    </Form>
                  ))}
                </DropdownMenuGroup>
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
