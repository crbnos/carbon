// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Avatar,
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  NavRailSwitcher,
  ScrollArea,
  useDisclosure,
  useMode
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { IoMdAdd } from "react-icons/io";
import { LuChevronsUpDown } from "react-icons/lu";
import {
  Form,
  Link,
  useLocation,
  useNavigation,
  useParams
} from "react-router";
import { useRouteData, useUser } from "~/hooks";
import type { Company } from "~/modules/settings";
import { path } from "~/utils/path";
import { AddCompanyModal } from "./AddCompanyModal";

// Switching company keeps a page that exists in every company (a list, a
// settings page). A record's page does not, so that goes to the home page.
export function useCompanySwitchRedirect() {
  const params = useParams();
  const { pathname, search } = useLocation();
  return Object.keys(params).length === 0 ? `${pathname}${search}` : undefined;
}

/**
 * The user's companies grouped by company group (single-company groups fold
 * into "Companies"). Used by the company switcher and the compact Profile sheet.
 */
export function useCompanyGroups() {
  const { t } = useLingui();
  const routeData = useRouteData<{ company: Company; companies: Company[] }>(
    path.to.authenticatedRoot
  );
  // The ungrouped heading is a translated label, and the fold below must
  // compare against that same label, not the English source.
  const ungrouped = t`Companies`;
  return useMemo(() => {
    if (!routeData?.companies) return [];

    const groups = new Map<string, { name: string; companies: Company[] }>();

    for (const c of routeData.companies) {
      const groupName = c.companyGroupName ?? ungrouped;
      const existing = groups.get(groupName);
      if (existing) {
        existing.companies.push(c);
      } else {
        groups.set(groupName, { name: groupName, companies: [c] });
      }
    }

    // A group of one company folds into the ungrouped heading.
    const result = new Map<string, { name: string; companies: Company[] }>();
    for (const [key, group] of groups) {
      const target = group.companies.length === 1 ? ungrouped : key;
      const existing = result.get(target);
      if (existing) {
        existing.companies.push(...group.companies);
      } else {
        result.set(target, { name: target, companies: [...group.companies] });
      }
    }

    return Array.from(result.values());
  }, [routeData?.companies, ungrouped]);
}

/**
 * The rail's header: the company's logo and name, which switch company when
 * the user has more than one (or can add one). Desktop only — phones switch
 * company from the Profile sheet.
 */
const CompanySwitcher = () => {
  const { t } = useLingui();
  const switchRedirect = useCompanySwitchRedirect();
  const routeData = useRouteData<{ company: Company; companies: Company[] }>(
    path.to.authenticatedRoot
  );
  const user = useUser();
  const mode = useMode();
  const companyGroups = useCompanyGroups();
  const companyForm = useDisclosure();
  // A switch is a full POST navigation: block a second one while it runs.
  const navigation = useNavigation();

  const hasMultipleCompanies = (routeData?.companies?.length ?? 0) > 1;
  const canCreateCompany = user.admin === true;

  const brand = {
    label: user.company.name ?? "",
    logoLight: user.company.logoLightIcon,
    logoDark: user.company.logoDarkIcon
  };

  if (!hasMultipleCompanies && !canCreateCompany) {
    return (
      <NavRailSwitcher asChild {...brand}>
        <Link to={path.to.authenticatedRoot} />
      </NavRailSwitcher>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <NavRailSwitcher {...brand} trailing={<LuChevronsUpDown />} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[240px]">
          <ScrollArea className="max-h-[300px]">
            {companyGroups.map((group, index) => (
              <DropdownMenuGroup key={group.name}>
                {index > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel>{group.name}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {group.companies.map((c) => {
                  const companyLogo =
                    mode === "dark" ? c.logoDarkIcon : c.logoLightIcon;
                  const isCurrent = c.companyId === user.company.id;

                  return (
                    <Form
                      key={c.companyId}
                      method="post"
                      action={path.to.companySwitch(c.companyId!)}
                    >
                      {switchRedirect && (
                        <input
                          type="hidden"
                          name="redirectTo"
                          value={switchRedirect}
                        />
                      )}
                      <DropdownMenuItem
                        className="flex items-center justify-between w-full"
                        asChild
                        disabled={isCurrent}
                      >
                        <button
                          type="submit"
                          disabled={navigation.state === "submitting"}
                        >
                          <HStack>
                            <Avatar
                              size="xs"
                              name={c.name ?? undefined}
                              src={companyLogo ?? undefined}
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

          {canCreateCompany && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={companyForm.onOpen}>
                  <DropdownMenuIcon icon={<IoMdAdd />} />
                  {t`Add Company`}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AddCompanyModal
        open={companyForm.isOpen}
        onClose={companyForm.onClose}
      />
    </>
  );
};

export default CompanySwitcher;
