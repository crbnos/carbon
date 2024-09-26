import { redirect } from "react-router-dom";
import { supabase } from "./supabase";

export async function requireAuthentication() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw redirect("/");
}
