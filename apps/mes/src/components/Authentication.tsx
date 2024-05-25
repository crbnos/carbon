import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { supabase } from "~/lib/supabase";
import { Login } from "../routes/login";

export function Authentication() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
  }, []);

  return (
    <>
      <div className="background">
        <div className="gradient" />
      </div>
      <div className="relative z-10">
        <div className="flex flex-col min-w-screen h-screen min-h-0">
          {!session ? <Login /> : <Outlet context={{ session }} />}
        </div>
      </div>
    </>
  );
}
