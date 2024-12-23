import { useRouteData } from "@carbon/remix";
import { path } from "~/utils/path";

type PersonalData = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
};

type Company = {
  id: string;
  name: string;
  logoLightIcon: string | null;
  logoDarkIcon: string | null;
  logoLight: string | null;
  logoDark: string | null;
};

type User = PersonalData & {
  company: Company;
};

export function useUser(): User {
  const data = useRouteData<{
    company: unknown;
    user: unknown;
  }>(path.to.authenticatedRoot);

  if (
    data?.company &&
    isCompany(data.company) &&
    data?.user &&
    isUser(data.user)
  ) {
    return {
      ...data.user,
      company: data.company,
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
    (typeof value.logoLightIcon === "string" || value.logoLightIcon === null) &&
    (typeof value.logoDarkIcon === "string" || value.logoDarkIcon === null) &&
    (typeof value.logoLight === "string" || value.logoLight === null) &&
    (typeof value.logoDark === "string" || value.logoDark === null)
  );
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
