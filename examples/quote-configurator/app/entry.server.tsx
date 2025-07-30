import { RemixServer } from "@remix-run/react";
import type { EntryContext } from "@vercel/remix";
import { handleRequest } from "@vercel/remix";



export default async function (
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {

 
  return handleRequest(
    request,
    responseStatusCode,
    responseHeaders,
    <RemixServer context={remixContext} url={request.url} />
  );
}
