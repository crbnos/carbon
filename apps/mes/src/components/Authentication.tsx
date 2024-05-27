import { Spinner, useMount } from "@carbon/react";
import type { Session } from "@supabase/supabase-js";
import { useCallback, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { path } from "~/config";
import { supabase } from "~/lib/supabase";
import { Login } from "~/routes/login";
import { getUser } from "~/services";
import type { User } from "~/types";

export function Authentication() {
  const [initializing, setInitializing] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useMount(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setInitializing(false);
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
  });

  return (
    <>
      <div className="background">
        <div className="gradient" />
      </div>
      <div className="relative z-10">
        <div className="flex flex-col min-w-screen h-screen min-h-0">
          {initializing ? (
            <Loading />
          ) : !session ? (
            <Login />
          ) : (
            <Protected session={session} />
          )}
        </div>
      </div>
    </>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center h-full">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

function Protected({ session }: { session: Session }) {
  if (!session) throw new Error("Session is not defined");

  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState<User>(null);

  const getUserData = async () => {
    const { data, error } = await getUser(supabase, session.user.id);
    if (error || !data) {
      throw new Error("User not found");
    }

    setUser(data);
  };

  useMount(() => {
    if (location.pathname === path.to.root) {
      navigate(path.to.jobs);
    }
    getUserData();
  });

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    navigate(path.to.root);
  }, [navigate]);

  return (
    <main className="flex flex-col h-full w-full">
      <Outlet context={{ user, signOut }} />
    </main>
  );
}
