import {
  Avatar,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  ScrollArea,
  useMode
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { BsFillHexagonFill } from "react-icons/bs";
import { LuChevronsUpDown, LuHouse } from "react-icons/lu";
import { Form, Link } from "react-router";
import { useRouteData, useUser } from "~/hooks";
import type { Company } from "~/modules/settings";
import { path } from "~/utils/path";

const CompanySwitcher = () => {
  const { t } = useLingui();
  const routeData = useRouteData<{ company: Company; companies: Company[] }>(
    path.to.authenticatedRoot
  );
  const user = useUser();
  const mode = useMode();

  const hasMultipleCompanies = Boolean(
    routeData?.companies && routeData?.companies.length > 1
  );

  const canSwitchCompany = hasMultipleCompanies;

  const companyGroups = useMemo(() => {
    if (!routeData?.companies) return [];

    const groups = new Map<string, { name: string; companies: Company[] }>();

    for (const c of routeData.companies) {
      const groupName = c.companyGroupName ?? t`Companies`;
      const existing = groups.get(groupName);
      if (existing) {
        existing.companies.push(c);
      } else {
        groups.set(groupName, { name: groupName, companies: [c] });
      }
    }

    // If a group has only one company, move it to "Companies"
    const result = new Map<string, { name: string; companies: Company[] }>();
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
  }, [routeData?.companies, t]);

  if (!canSwitchCompany) {
    // Just show the company logo without dropdown
    const logo =
      mode === "dark"
        ? user.company?.logoDarkIcon
        : user.company?.logoLightIcon;

    return (
      <Button isIcon asChild variant="ghost" size="lg">
        <Link to="/">
          {logo ? (
            <img
              src={logo}
              alt={`${user.company.name} logo`}
              className="size-full object-contain rounded"
            />
          ) : (
            <BsFillHexagonFill />
          )}
        </Link>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="px-2 focus-visible:ring-transparent"
          rightIcon={<LuChevronsUpDown />}
        >
          {(() => {
            const logo =
              mode === "dark"
                ? user.company?.logoDarkIcon
                : user.company?.logoLightIcon;
            return logo ? (
              <img
                src={logo}
                alt={`${user.company.name} logo`}
                className="h-7 w-auto max-w-[140px] object-contain rounded"
              />
            ) : (
              <BsFillHexagonFill />
            );
          })()}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[240px]">
        <DropdownMenuItem asChild>
          <Link to={path.to.authenticatedRoot}>
            <DropdownMenuIcon icon={<LuHouse />} />
            <Trans>Dashboard</Trans>
          </Link>
        </DropdownMenuItem>
        <ScrollArea className="max-h-[300px]">
          {companyGroups.map((group, index) => (
            <DropdownMenuGroup key={group.name}>
              {index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel>{group.name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {group.companies.map((c) => {
                const logo = mode === "dark" ? c.logoDarkIcon : c.logoLightIcon;
                const isCurrent = c.companyId === user.company.id;

                return (
                  <Form
                    key={c.companyId}
                    method="post"
                    action={path.to.companySwitch(c.companyId!)}
                  >
                    <DropdownMenuItem
                      className="flex items-center justify-between w-full"
                      asChild
                      disabled={isCurrent}
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
  );
};

export default CompanySwitcher;
