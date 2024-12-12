import {
  Button,
  HStack,
  Heading,
  IconButton,
  useDisclosure,
} from "@carbon/react";
import { Link, useParams } from "@remix-run/react";
import { LuPanelLeft, LuPanelRight } from "react-icons/lu";
import { usePanels } from "~/components/Layout";
import { usePermissions, useRouteData } from "~/hooks";
import type { Receipt, ReceiptLine } from "~/modules/inventory";
import { ReceiptPostModal, ReceiptStatus } from "~/modules/inventory";
import { path } from "~/utils/path";

const ReceiptHeader = () => {
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");

  const { toggleExplorer, toggleProperties } = usePanels();

  const routeData = useRouteData<{
    receipt: Receipt;
    receiptLines: ReceiptLine[];
  }>(path.to.receipt(receiptId));

  if (!routeData?.receipt) throw new Error("Failed to load receipt");

  const permissions = usePermissions();
  const postModal = useDisclosure();

  const canPost =
    routeData.receiptLines.length > 0 &&
    routeData.receiptLines.some((line) => line.receivedQuantity > 0);

  const isPosted = routeData.receipt.status === "Posted";

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between p-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide">
        <HStack className="w-full justify-between">
          <HStack>
            <IconButton
              aria-label="Toggle Explorer"
              icon={<LuPanelLeft />}
              onClick={toggleExplorer}
              variant="ghost"
            />
            <Link to={path.to.receiptDetails(receiptId)}>
              <Heading size="h3" className="flex items-center gap-2">
                <span>{routeData?.receipt?.receiptId}</span>
              </Heading>
            </Link>
            <ReceiptStatus status={routeData?.receipt?.status} />
          </HStack>
          <HStack>
            <Button
              variant={canPost && !isPosted ? "primary" : "secondary"}
              onClick={postModal.onOpen}
              isDisabled={!canPost || isPosted || !permissions.is("employee")}
            >
              Post
            </Button>

            <IconButton
              aria-label="Toggle Properties"
              icon={<LuPanelRight />}
              onClick={toggleProperties}
              variant="ghost"
            />
          </HStack>
        </HStack>
      </div>

      {postModal.isOpen && <ReceiptPostModal onClose={postModal.onClose} />}
    </>
  );
};

export default ReceiptHeader;
