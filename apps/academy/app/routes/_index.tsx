import { redirect, type LoaderFunctionArgs } from "@vercel/remix";
import { modules } from "~/config";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  throw redirect(path.to.course(modules[0].id, modules[0].courses[0].id));
}

export default function IndexRoute() {
  return null;
}
