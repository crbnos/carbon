import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

// Legacy URL shim: /x/items/change-order/* → /x/items/change-notice/*
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  throw redirect(
    `${url.pathname.replace(
      "/items/change-order",
      "/items/change-notice"
    )}${url.search}`,
    301
  );
}
