import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

// Legacy URL shim: /x/items/change-order-types/* → /x/items/change-notice-types/*
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  throw redirect(
    `${url.pathname.replace(
      "/items/change-order-types",
      "/items/change-notice-types"
    )}${url.search}`,
    301
  );
}
