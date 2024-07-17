import {
  ClientOnly,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ScrollArea,
} from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useParams } from "@remix-run/react";
import { getQuote, QuoteHeader } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Quote",
  to: path.to.quotes,
  module: "sales",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
  });

  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");

  const [quote] = await Promise.all([getQuote(client, quoteId)]);

  if (quote.error) {
    throw redirect(
      path.to.items,
      await flash(request, error(quote.error, "Failed to load quote"))
    );
  }

  return json({
    quote: quote.data,
  });
}

export default function QuoteRoute() {
  const params = useParams();
  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");

  return (
    <div className="flex flex-col h-[calc(100vh-49px)] w-full">
      <QuoteHeader />
      <div className="flex h-[calc(100vh-99px)] w-full">
        <div className="flex h-full w-full overflow-y-auto">
          <div className="flex flex-grow overflow-hidden">
            <ClientOnly fallback={null}>
              {() => (
                <ResizablePanelGroup direction="horizontal">
                  <ResizablePanel
                    order={1}
                    minSize={10}
                    defaultSize={20}
                    className="bg-card"
                  >
                    <ScrollArea className="h-[calc(100vh-99px)]">
                      <div className="grid h-full overflow-hidden p-2">
                        <QuoteExplorer />
                      </div>
                    </ScrollArea>
                  </ResizablePanel>
                  <ResizableHandle withHandle />
                  <ResizablePanel
                    order={2}
                    minSize={40}
                    defaultSize={60}
                    className="border-t border-border"
                  >
                    <ScrollArea className="h-[calc(100vh-99px)]">
                      <Outlet key={JSON.stringify(params)} />
                    </ScrollArea>
                  </ResizablePanel>
                </ResizablePanelGroup>
              )}
            </ClientOnly>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuoteExplorer() {
  return null;
}
