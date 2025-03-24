import { useUser } from "./useUser";

export function useFlags() {
  const user = useUser();
  const isInternal = [
    "carbon.us.org",
    "carbonos.dev",
    "gravyfries@protonmail.com",
  ].some((email) => user.email.includes(email));

  return {
    isInternal,
  };
}
