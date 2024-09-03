import { Badge, Button, HStack, Heading, useDisclosure } from "@carbon/react";

import { Form, Link, useParams } from "@remix-run/react";
import {
  LuCheckCheck,
  LuEye,
  LuRefreshCw,
  LuSend,
  LuTrophy,
  LuXCircle,
} from "react-icons/lu";
import { RiProgress4Line } from "react-icons/ri";
import { Assignee, useOptimisticAssignment } from "~/components";

import { usePermissions, useRouteData } from "~/hooks";
import type { Quotation, QuotationLine, QuotationPrice } from "~/modules/sales";
import { path } from "~/utils/path";
import QuoteFinalizeModal from "./QuoteFinalizeModal";
import QuoteStatus from "./QuoteStatus";
import QuoteToOrderModal from "./QuoteToOrderModal";

const QuoteHeader = () => {
  const permissions = usePermissions();
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");

  const routeData = useRouteData<{
    quote: Quotation;
    lines: QuotationLine[];
    prices: QuotationPrice[];
  }>(path.to.quote(quoteId));

  const finalizeModal = useDisclosure();
  const convertToOrderModal = useDisclosure();

  const optimisticAssignment = useOptimisticAssignment({
    id: quoteId,
    table: "quote",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.quote?.assignee;

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border">
        <HStack className="w-full justify-between">
          <HStack>
            <Link to={path.to.quoteDetails(quoteId)}>
              <Heading size="h2">{routeData?.quote?.quoteId}</Heading>
            </Link>
            <Badge variant="secondary">
              <Badge variant="secondary">
                <RiProgress4Line />
              </Badge>
            </Badge>
            <QuoteStatus status={routeData?.quote?.status} />
          </HStack>
          <HStack>
            <Assignee
              id={quoteId}
              table="quote"
              value={assignee ?? ""}
              className="h-8"
              isReadOnly={!permissions.can("update", "sales")}
            />
            <Button leftIcon={<LuEye />} variant="secondary" asChild>
              <a
                target="_blank"
                href={path.to.file.quote(quoteId)}
                rel="noreferrer"
              >
                Preview
              </a>
            </Button>
            {routeData?.quote?.status === "Draft" && (
              <>
                <Form method="post" action={path.to.quoteStatus(quoteId)}>
                  <input type="hidden" name="status" value="Cancelled" />
                  <Button
                    isDisabled={!permissions.can("update", "sales")}
                    leftIcon={<LuXCircle />}
                    type="submit"
                    variant="destructive"
                  >
                    Cancel
                  </Button>
                </Form>
                <Button
                  onClick={finalizeModal.onOpen}
                  isDisabled={
                    !permissions.can("update", "sales") ||
                    !routeData?.lines?.length
                  }
                  leftIcon={<LuCheckCheck />}
                >
                  Finalize
                </Button>
              </>
            )}
            {routeData?.quote?.status === "Sent" && (
              <>
                <Form method="post" action={path.to.quoteStatus(quoteId)}>
                  <input type="hidden" name="status" value="Draft" />
                  <Button
                    isDisabled={!permissions.can("update", "sales")}
                    leftIcon={<LuRefreshCw />}
                    type="submit"
                    variant="secondary"
                  >
                    Reopen
                  </Button>
                </Form>
                <Form method="post" action={path.to.quoteStatus(quoteId)}>
                  <input type="hidden" name="status" value="Lost" />
                  <Button
                    isDisabled={!permissions.can("update", "sales")}
                    leftIcon={<LuXCircle />}
                    type="submit"
                    variant="destructive"
                  >
                    Lost
                  </Button>
                </Form>

                <Button
                  leftIcon={<LuTrophy />}
                  variant="primary"
                  onClick={convertToOrderModal.onOpen}
                >
                  Won
                </Button>
              </>
            )}
            {["Cancelled", "Expired", "Lost"].includes(
              routeData?.quote?.status ?? ""
            ) && (
              <>
                <Form method="post" action={path.to.quoteStatus(quoteId)}>
                  <input type="hidden" name="status" value="Draft" />
                  <Button
                    isDisabled={!permissions.can("update", "sales")}
                    leftIcon={<LuRefreshCw />}
                    type="submit"
                    variant="secondary"
                  >
                    Reopen
                  </Button>
                </Form>
              </>
            )}
            {["Ordered", "Partial"].includes(routeData?.quote?.status ?? "") ? (
              routeData?.quote?.salesOrderId ? (
                <Button
                  isDisabled={!routeData?.quote.salesOrderId}
                  leftIcon={<LuSend />}
                  variant="primary"
                  asChild
                >
                  <Link
                    to={path.to.salesOrderDetails(
                      routeData?.quote.salesOrderId!
                    )}
                    prefetch="intent"
                  >
                    View Order
                  </Link>
                </Button>
              ) : (
                <Form method="post" action={path.to.quoteStatus(quoteId)}>
                  <input type="hidden" name="status" value="Draft" />
                  <Button
                    isDisabled={!permissions.can("update", "sales")}
                    leftIcon={<LuRefreshCw />}
                    type="submit"
                    variant="secondary"
                  >
                    Reopen
                  </Button>
                </Form>
              )
            ) : null}
          </HStack>
        </HStack>
      </div>
      {finalizeModal.isOpen && (
        <QuoteFinalizeModal
          quote={routeData?.quote}
          onClose={finalizeModal.onClose}
        />
      )}
      {/* we use isOpen so we don't lose state */}
      <QuoteToOrderModal
        isOpen={convertToOrderModal.isOpen}
        onClose={convertToOrderModal.onClose}
        quote={routeData?.quote!}
        lines={routeData?.lines ?? []}
        pricing={routeData?.prices ?? []}
      />
    </>
  );
};

export default QuoteHeader;
