import { DOMAIN } from "@carbon/auth";
import * as cookie from "cookie";

const cookieName = "companyId";

export function setCompanyId(companyId: string | null) {
  if (!companyId) {
    return cookie.serialize(cookieName, "", {
      path: "/",
      expires: new Date(0),
      domain: DOMAIN,
    });
  }

  return cookie.serialize(cookieName, companyId, {
    path: "/",
    maxAge: 31536000, // 1 year
    domain: DOMAIN,
  });
}
