import { redirect } from "@vercel/remix";
import { path } from "~/utils/path";

export async function loader() {
  throw redirect(path.to.profile);
}
