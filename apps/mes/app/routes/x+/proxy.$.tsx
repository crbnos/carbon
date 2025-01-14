import type { ActionFunctionArgs } from "@vercel/remix";
import { ERP_URL } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const path = params["*"];

  // Create new headers without host header to avoid connection refused
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("origin");

  try {
    const response = await fetch(`${ERP_URL}/${path}`, {
      method: request.method,
      body: request.body,
      headers,
      duplex: "half", // Add duplex option when sending body
    });

    return response;
  } catch (error) {
    console.error("Proxy request failed:", error);
    return new Response("Proxy request failed", { status: 500 });
  }
}
