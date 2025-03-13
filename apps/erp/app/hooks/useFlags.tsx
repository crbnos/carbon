import { useUser } from "./useUser";

export function useFlags() {
  const user = useUser();
  const isInternal = ["carbon.us.org", "carbonos.dev"].some((email) =>
    user.email.includes(email)
  );

  return {
    isInternal,
  };
}
