import {
  HStack,
  Heading,
  Menubar,
  MenubarItem,
  VStack,
  useDisclosure,
  useKeyboardShortcuts,
} from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData, useParams } from "@remix-run/react";
import { useEffect, useRef } from "react";
import {
  Assignee,
  CustomerAvatar,
  useOptimisticAssignment,
} from "~/components";
import { useSupabase } from "~/lib/supabase";
import { getLocationsList } from "~/modules/resources";
import {
  QuotationExplorer,
  QuotationStatus,
  getQuote,
  getQuoteAssemblies,
  getQuoteExternalDocuments,
  getQuoteInternalDocuments,
  getQuoteLines,
  getQuoteMaterials,
  getQuoteOperations,
  useQuotation,
} from "~/modules/sales";
import ConvertToSalesOrderModal from "~/modules/sales/ui/Quotation/ConvertToSalesOrderModal";
import QuotationReleaseModal from "~/modules/sales/ui/Quotation/QuotationReleaseModal";

import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { useCustomers } from "~/stores";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Quotations",
  to: path.to.quotes,
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [
    quotation,
    quotationLines,
    quotationAssemblies,
    quotationMaterials,
    quotationOperations,
    externalDocuments,
    internalDocuments,
    locations,
  ] = await Promise.all([
    getQuote(client, id),
    getQuoteLines(client, id),
    getQuoteAssemblies(client, id),
    getQuoteMaterials(client, id),
    getQuoteOperations(client, id),
    getQuoteExternalDocuments(client, companyId, id),
    getQuoteInternalDocuments(client, companyId, id),
    getLocationsList(client, companyId),
  ]);

  if (quotation.error) {
    throw redirect(
      path.to.quotes,
      await flash(
        request,
        error(quotation.error, "Failed to load quotation summary")
      )
    );
  }

  return json({
    quotation: quotation.data,
    quotationLines: quotationLines.data ?? [],
    quotationAssemblies: quotationAssemblies.data ?? [],
    quotationMaterials: quotationMaterials.data ?? [],
    quotationOperations: quotationOperations.data ?? [],
    externalDocuments: externalDocuments.data ?? [],
    internalDocuments: internalDocuments.data ?? [],
    locations: locations.data ?? [],
  });
}

export async function action({ request }: ActionFunctionArgs) {
  throw redirect(request.headers.get("Referer") ?? request.url);
}

export default function QuotationRoute() {
  const { supabase } = useSupabase();
  const {
    quotation,
    quotationLines,
    quotationAssemblies,
    quotationMaterials,
    quotationOperations,
  } = useLoaderData<typeof loader>();
  const releaseDisclosure = useDisclosure();
  const salesOrderDisclosure = useDisclosure();

  const [quote, setQuote] = useQuotation();

  useEffect(() => {
    setQuote({
      quote: quotation,
      lines: quotationLines,
      assemblies: quotationAssemblies,
      materials: quotationMaterials,
      operations: quotationOperations,
    });
  }, [
    quotationLines,
    quotationAssemblies,
    quotationMaterials,
    quotationOperations,
    setQuote,
    quotation,
    supabase,
  ]);

  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const isReleased = !["Draft"].includes(quote.quote?.status ?? "");

  const buttonRef = useRef<HTMLButtonElement>(null);
  useKeyboardShortcuts({
    l: (event: KeyboardEvent) => {
      event.stopPropagation();
      buttonRef.current?.click();
    },
  });

  const [customers] = useCustomers();
  const customer = customers.find((s) => s.id === quotation?.customerId) ?? {
    name: "",
    id: "",
  };

  const optimisticAssignment = useOptimisticAssignment({
    id: id,
    table: "quote",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : quotation?.assignee;

  return (
    <div className="flex h-[calc(100vh-49px)]">
      <VStack className="w-96 h-full z-40 overflow-y-scroll bg-card border-r border-border">
        <VStack
          className="bg-card border-b border-border px-4 py-2 sticky top-0 z-50"
          spacing={1}
        >
          <HStack className="justify-between w-full">
            <Heading size="h4" noOfLines={1}>
              {quote.quote?.quoteId}
            </Heading>
            {quote.quote && <QuotationStatus status={quote.quote?.status} />}
          </HStack>
        </VStack>
        <VStack className="border-b border-border px-4 py-2 text-sm">
          <HStack className="justify-between w-full">
            <span className="text-xs text-muted-foreground">Customer</span>
            <CustomerAvatar customerId={customer.id} />
          </HStack>
        </VStack>
        <VStack className="border-b border-border px-4 py-2 text-sm">
          <HStack className="justify-between w-full">
            <span className="text-xs text-muted-foreground">Assignee</span>
            <Assignee id={id} table="quote" value={assignee ?? undefined} />
          </HStack>
        </VStack>
        <QuotationExplorer />
      </VStack>

      <div className="flex w-full h-full">
        <div className="w-full h-full flex-1 overflow-hidden">
          <VStack
            spacing={4}
            className="h-full w-full overflow-x-hidden flex-1 p-4"
          >
            <Menubar>
              <MenubarItem asChild>
                <a
                  target="_blank"
                  href={path.to.file.quote(id)}
                  rel="noreferrer"
                >
                  Preview
                </a>
              </MenubarItem>
              <MenubarItem
                onClick={releaseDisclosure.onOpen}
                isDisabled={isReleased}
              >
                Release
              </MenubarItem>
              <MenubarItem onClick={salesOrderDisclosure.onOpen}>
                Convert
              </MenubarItem>
            </Menubar>
            <Outlet />
          </VStack>
        </div>
      </div>
      {releaseDisclosure.isOpen && (
        <QuotationReleaseModal
          quotation={quotation}
          onClose={releaseDisclosure.onClose}
        />
      )}
      {salesOrderDisclosure.isOpen && (
        <ConvertToSalesOrderModal
          quotation={quotation}
          onClose={salesOrderDisclosure.onClose}
        />
      )}
    </div>
  );
}
