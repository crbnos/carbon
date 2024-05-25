import type { Session } from "@supabase/supabase-js";
import { useOutletContext } from "react-router-dom";

export function useSession(): Session {
  const { session } = useOutletContext<{ session: Session | null }>();

  if (!session) {
    throw new Error(
      "useSession must be used within a route an authenticated route"
    );
  }

  return session;
}
