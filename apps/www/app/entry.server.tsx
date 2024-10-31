import { RemixServer } from "@remix-run/react";
import type { EntryContext } from "@vercel/remix";
import { handleRequest } from "@vercel/remix";

export default async function (
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  // const acceptLanguage = request.headers.get("accept-language");
  // const locales = parseAcceptLanguage(acceptLanguage, {
  //   validate: Intl.DateTimeFormat.supportedLocalesOf,
  // });

  // // get whether it's a mac or pc from the headers
  // const platform: OperatingSystemPlatform = request.headers
  //   .get("user-agent")
  //   ?.includes("Mac")
  //   ? "mac"
  //   : "windows";
  let remixServer = (
    // <OperatingSystemContextProvider platform={platform}>
    //   <I18nProvider locale={locales?.[0] ?? "en-US"}>
    <RemixServer context={remixContext} url={request.url} />
    //   </I18nProvider>
    // </OperatingSystemContextProvider>
  );
  return handleRequest(
    request,
    responseStatusCode,
    responseHeaders,
    remixServer
  );
}
