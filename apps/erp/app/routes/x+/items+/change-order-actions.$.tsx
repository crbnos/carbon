import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

// Legacy URL shim: /x/items/change-order-actions/* → /x/items/change-notice-actions/*
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  throw redirect(
    `${url.pathname.replace(
      "/items/change-order-actions",
      "/items/change-notice-actions"
    )}${url.search}`,
    301
  );
}
