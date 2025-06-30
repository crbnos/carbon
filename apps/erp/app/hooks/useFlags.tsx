import { useUser } from "./useUser";

export function useFlags() {
  const user = useUser();
  const isInternal = ["carbon.us.org", "carbonos.dev", "blackcatlabs.xyz"].some(
    (email) => user.email.includes(email)
  );

  return {
    isInternal,
  };
}
