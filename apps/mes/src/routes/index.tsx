import { Button } from "@carbon/react";
import { supabase } from "~/lib/supabase";

export const Home = () => {
  console.log(supabase.auth.getUser());
  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <Button size="md" onClick={signOut}>
      Sign Out
    </Button>
  );
};
