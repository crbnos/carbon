import { Button } from "@carbon/react";
import { supabase } from "~/lib/supabase";

export const Home = () => {
  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen space-y-4">
      <Button size="lg" onClick={signOut}>
        Sign Out
      </Button>
    </div>
  );
};
