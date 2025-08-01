import { useEdition } from "@carbon/remix";
import { Edition } from "@carbon/utils";
import { useUser } from "./useUser";

export function useFlags() {
  const user = useUser();
  const edition = useEdition();
  const isInternal = ["@carbon.us.org", "@carbon.ms", "@carbon.ms"].some(
    (email) => user.email.includes(email)
  );

  return {
    isInternal,
    isCloud: edition === Edition.Cloud,
    isCommunity: edition === Edition.Community,
    isEnterprise: edition === Edition.Enterprise,
  };
}
