import { CONTROLLED_ENVIRONMENT } from "@carbon/auth";
import { useEdition } from "@carbon/react";
import { Edition, isInternalEmail } from "@carbon/utils";
import { useUser } from "./useUser";

export function useFlags() {
  const user = useUser();
  const edition = useEdition();
  const isInternal = isInternalEmail(user.email);

  return {
    isInternal,
    isCloud: edition === Edition.Cloud,
    isCommunity: edition === Edition.Community,
    isEnterprise: edition === Edition.Enterprise,
    isControlledEnvironment: CONTROLLED_ENVIRONMENT
  };
}
