import { requirePermissions } from "@carbon/auth/auth.server";
import type { JSONContent } from "@carbon/react";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  generateHTML,
  Heading,
  HStack,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { useMode } from "@carbon/remix";
import { formatDate } from "@carbon/utils";
import { motion } from "framer-motion";
import { useState } from "react";
import { LuChevronRight, LuImage } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getPurchasingRFQ,
  getPurchasingRFQLines
} from "~/modules/purchasing/purchasing.service";
import type { PurchasingRFQLine } from "~/modules/purchasing/types";
import type { Company } from "~/modules/settings";
import { getCompany } from "~/modules/settings";
import { getBase64ImageFromSupabase } from "~/modules/shared";

export const meta = () => {
  return [{ title: "RFQ Preview" }];
};

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) {
    return {
      error: "RFQ not found",
      data: null
    };
  }

  // Require authentication - this is an internal preview
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const [rfqResult, linesResult, company] = await Promise.all([
    getPurchasingRFQ(client, id),
    getPurchasingRFQLines(client, id),
    getCompany(client, companyId)
  ]);

  if (rfqResult.error || !rfqResult.data) {
    return {
      error: "RFQ not found",
      data: null
    };
  }

  // Get thumbnails for line items
  const thumbnailPaths = linesResult.data?.reduce<
    Record<string, string | null>
  >((acc, line) => {
    if (line.thumbnailPath) {
      acc[line.id] = line.thumbnailPath;
    }
    return acc;
  }, {});

  const thumbnails: Record<string, string | null> =
    (thumbnailPaths
      ? await Promise.all(
          Object.entries(thumbnailPaths).map(([lineId, path]) => {
            if (!path) return null;
            return getBase64ImageFromSupabase(client, path).then((data) => ({
              id: lineId,
              data
            }));
          })
        )
      : []
    )?.reduce<Record<string, string | null>>((acc, thumbnail) => {
      if (thumbnail) {
        acc[thumbnail.id] = thumbnail.data;
      }
      return acc;
    }, {}) ?? {};

  return {
    error: null,
    data: {
      rfq: rfqResult.data,
      lines: linesResult.data ?? [],
      company: company.data,
      thumbnails
    }
  };
}

const Header = ({ company, rfq }: { company: Company | null; rfq: any }) => (
  <CardHeader className="flex flex-col sm:flex-row items-start sm:items-start justify-between gap-4 sm:space-y-2 pb-7">
    <VStack spacing={4}>
      <div>
        <CardTitle className="text-3xl">{company?.name ?? ""}</CardTitle>
        {rfq?.rfqId && (
          <p className="text-lg text-muted-foreground">{rfq.rfqId}</p>
        )}
        {rfq?.dueDate && (
          <p className="text-lg text-muted-foreground">
            Due {formatDate(rfq.dueDate)}
          </p>
        )}
      </div>
      <span className="text-base text-muted-foreground">
        This is a preview of how suppliers will see the quote request
      </span>
    </VStack>
  </CardHeader>
);

const NotesDisplay = ({ notes }: { notes: JSONContent | null }) => {
  if (!notes || Object.keys(notes).length === 0) return null;

  return (
    <div
      className="prose dark:prose-invert mt-2 text-muted-foreground"
      dangerouslySetInnerHTML={{
        __html: generateHTML(notes)
      }}
    />
  );
};

const LineItems = ({
  lines,
  thumbnails
}: {
  lines: PurchasingRFQLine[];
  thumbnails: Record<string, string | null>;
}) => {
  const [openItems, setOpenItems] = useState<string[]>(() =>
    lines.map((line) => line.id).filter(Boolean)
  );

  const toggleOpen = (id: string) => {
    setOpenItems((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <VStack spacing={8} className="w-full">
      {lines.map((line) => {
        if (!line.id) return null;

        return (
          <motion.div
            key={line.id}
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="border-b border-input py-6 w-full"
          >
            <HStack spacing={4} className="items-start">
              {thumbnails[line.id] ? (
                <img
                  alt={line.itemReadableId ?? "Item"}
                  className="w-24 h-24 bg-gradient-to-bl from-muted to-muted/40 rounded-lg"
                  src={thumbnails[line.id] ?? undefined}
                />
              ) : (
                <div className="w-24 h-24 bg-gradient-to-bl from-muted to-muted/40 rounded-lg p-4">
                  <LuImage className="w-16 h-16 text-muted-foreground" />
                </div>
              )}

              <VStack spacing={0} className="w-full">
                <div
                  className="flex flex-col cursor-pointer w-full"
                  onClick={() => toggleOpen(line.id)}
                >
                  <div className="flex items-center gap-x-4 justify-between flex-grow">
                    <Heading>{line.itemReadableId ?? "Item"}</Heading>
                    <HStack spacing={4}>
                      <motion.div
                        animate={{
                          rotate: openItems.includes(line.id) ? 90 : 0
                        }}
                        transition={{ duration: 0.3 }}
                      >
                        <LuChevronRight size={24} />
                      </motion.div>
                    </HStack>
                  </div>
                  <span className="text-muted-foreground text-base truncate">
                    {line.description}
                  </span>
                </div>
              </VStack>
            </HStack>

            <motion.div
              initial="collapsed"
              animate={openItems.includes(line.id) ? "open" : "collapsed"}
              variants={{
                open: { opacity: 1, height: "auto", marginTop: 16 },
                collapsed: { opacity: 0, height: 0, marginTop: 0 }
              }}
              transition={{ duration: 0.3 }}
              className="w-full overflow-hidden"
            >
              <LinePricing line={line} />
            </motion.div>
            <NotesDisplay notes={(line.externalNotes as JSONContent) || null} />
          </motion.div>
        );
      })}
    </VStack>
  );
};

const LinePricing = ({ line }: { line: PurchasingRFQLine }) => {
  const quantities =
    Array.isArray(line.quantity) && line.quantity.length > 0
      ? line.quantity
      : [1];

  return (
    <VStack spacing={4}>
      <Table>
        <Thead>
          <Tr className="whitespace-nowrap">
            <Th className="w-[50px]" />
            <Th className="w-2">Quantity</Th>
            <Th className="w-[150px]">Unit Price</Th>
            <Th className="w-[120px]">Lead Time</Th>
            <Th className="w-[150px]">Shipping Cost</Th>
            <Th className="w-[150px]">Tax</Th>
            <Th className="w-[100px]">Total</Th>
          </Tr>
        </Thead>
        <Tbody>
          {quantities.map((qty, index) => (
            <Tr key={index}>
              <Td className="w-[50px]">
                <div className="w-4 h-4 border rounded" />
              </Td>
              <Td>{qty}</Td>
              <Td className="text-muted-foreground">—</Td>
              <Td className="text-muted-foreground">—</Td>
              <Td className="text-muted-foreground">—</Td>
              <Td className="text-muted-foreground">—</Td>
              <Td className="text-muted-foreground">—</Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </VStack>
  );
};

const RFQPreview = ({
  data
}: {
  data: {
    company: Company | null;
    rfq: any;
    lines: PurchasingRFQLine[];
    thumbnails: Record<string, string | null>;
  };
}) => {
  const { company, rfq, lines, thumbnails } = data;
  const mode = useMode();
  const logo = mode === "dark" ? company?.logoDark : company?.logoLight;

  return (
    <VStack spacing={8} className="w-full items-center p-2 md:p-8">
      {logo && (
        <img
          src={logo}
          alt={company?.name ?? ""}
          className="w-auto mx-auto max-w-5xl"
        />
      )}

      <Badge variant="outline" className="text-lg px-4 py-2">
        Preview Mode
      </Badge>

      <Card className="w-full max-w-5xl mx-auto">
        <Header company={company} rfq={rfq} />
        <CardContent>
          <LineItems lines={lines} thumbnails={thumbnails} />

          <div className="mt-8 p-4 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground text-center">
              This is a preview of how suppliers will see the quote request.
              Finalize the RFQ to send it to suppliers.
            </p>
          </div>
        </CardContent>
      </Card>
    </VStack>
  );
};

const ErrorMessage = ({
  title,
  message
}: {
  title: string;
  message: string;
}) => {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
      <h1 className="text-3xl font-bold">{title}</h1>
      <p className="text-lg text-muted-foreground">{message}</p>
    </div>
  );
};

export default function PurchasingRFQPreview() {
  const { error, data } = useLoaderData<typeof loader>();

  if (error || !data) {
    return (
      <ErrorMessage
        title="RFQ not found"
        message="Oops! The RFQ you're trying to preview could not be found."
      />
    );
  }

  return <RFQPreview data={data} />;
}
