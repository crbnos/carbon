import type { LoaderFunctionArgs, MetaFunction } from "@vercel/remix";
import { redirect } from "@vercel/remix";

import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [
    {
      title: "Carbon Developers | Forgot Password",
    },
  ];
};

export async function loader({ request }: LoaderFunctionArgs) {
  throw redirect(path.to.forgotPassword);
}
