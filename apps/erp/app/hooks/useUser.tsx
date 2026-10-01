// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useRouteData } from "@carbon/react";
import { path } from "~/utils/path";

type PersonalData = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  admin: boolean;
};

type Company = {
  id: string;
  name: string;
  logoDarkIcon: string | null;
  logoLightIcon: string | null;
  logoDark: string | null;
  logoLight: string | null;
  countryCode: string | null;
  baseCurrencyCode: string;
  ownerId: string;
};

type Groups = string[];

type Defaults = {
  locationId: string | null;
};

type UserFlags = Record<string, boolean>;

type User = PersonalData & {
  company: Company;
  groups: Groups;
  defaults: Defaults;
  flags: UserFlags;
};

export function useUser(): User {
  const data = useRouteData<{
    company: unknown;
    user: unknown;
    groups: unknown;
    defaults: unknown;
  }>(path.to.authenticatedRoot);

  if (
    data?.company &&
    isCompany(data.company) &&
    data?.user &&
    isUser(data.user) &&
    data?.groups &&
    isGroups(data.groups) &&
    isDefaults(data.defaults)
  ) {
    return {
      ...data.user,
      company: data.company,
      groups: data.groups,
      defaults: data.defaults ?? { locationId: null },
      flags: data.user.flags ?? {}
    };
  }

  // TODO: force logout -- the likely cause is development changes
  throw new Error(
    "useUser must be used within an authenticated route. If you are seeing this error, you are likely in development and have changed the session variables. Try deleting the cookies."
  );
}

function isCompany(value: any): value is Company {
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (typeof value.logoDarkIcon === "string" || value.logoDarkIcon === null) &&
    (typeof value.logoLightIcon === "string" || value.logoLightIcon === null) &&
    (typeof value.logoDark === "string" || value.logoDark === null) &&
    (typeof value.logoLight === "string" || value.logoLight === null) &&
    (typeof value.countryCode === "string" || value.countryCode === null) &&
    typeof value.baseCurrencyCode === "string"
  );
}

function isDefaults(value: any): value is Defaults {
  return (
    value === null ||
    typeof value.locationId === "string" ||
    value.locationId === null
  );
}

function isGroups(value: any): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isUser(value: any): value is User {
  return (
    typeof value.id === "string" &&
    typeof value.email === "string" &&
    typeof value.firstName === "string" &&
    typeof value.lastName === "string" &&
    "avatarUrl" in value
  );
}
