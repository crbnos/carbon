import {
  Card,
  CardAction,
  CardAttribute,
  CardAttributeLabel,
  CardAttributeValue,
  CardAttributes,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  Menubar,
  MenubarItem,
  VStack,
  useDisclosure,
} from "@carbon/react";
import { formatDate } from "@carbon/utils";

import { useParams } from "@remix-run/react";
import { Assignee, useOptimisticAssignment } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useRouteData } from "~/hooks";
import type { Receipt, ReceiptLine } from "~/modules/inventory";
import { ReceiptPostModal, ReceiptStatus } from "~/modules/inventory";
import { path } from "~/utils/path";

const ReceiptHeader = () => {
  const permissions = usePermissions();
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");

  const postingModal = useDisclosure();

  const routeData = useRouteData<{
    receipt: Receipt;
    receiptLines: ReceiptLine[];
  }>(path.to.receipt(receiptId));

  if (!routeData) throw new Error("Could not find routeData");

  const canPost =
    routeData.receiptLines.length > 0 &&
    routeData.receiptLines.some((line) => line.receivedQuantity > 0);

  const isPosted = routeData.receipt.status === "Posted";

  const optimisticAssignment = useOptimisticAssignment({
    id: receiptId,
    table: "receipt",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.receipt?.assignee;

  return (
    <>
      <VStack>
        {permissions.is("employee") && (
          <Menubar>
            <MenubarItem
              isDisabled={!canPost || isPosted}
              onClick={postingModal.onOpen}
            >
              Post
            </MenubarItem>
          </Menubar>
        )}
        <Card>
          <HStack className="justify-between items-start">
            <CardHeader>
              <CardTitle>{routeData?.receipt?.receiptId}</CardTitle>
              <CardDescription>
                {routeData?.receipt?.locationName}
              </CardDescription>
            </CardHeader>
            <CardAction>
              {/* <Button
            variant="secondary"
            onClick={() => alert("TODO")}
            leftIcon={<FaHistory />}
          >
            View History
          </Button> */}
            </CardAction>
          </HStack>
          <CardContent>
            <CardAttributes>
              <CardAttribute>
                <CardAttributeLabel>Assignee</CardAttributeLabel>
                <CardAttributeValue>
                  <Assignee
                    id={receiptId}
                    table="receipt"
                    value={assignee ?? ""}
                    isReadOnly={!permissions.can("update", "inventory")}
                  />
                </CardAttributeValue>
              </CardAttribute>
              <CardAttribute>
                <CardAttributeLabel>Location</CardAttributeLabel>
                <CardAttributeValue>
                  <Enumerable value={routeData?.receipt?.locationName} />
                </CardAttributeValue>
              </CardAttribute>
              <CardAttribute>
                <CardAttributeLabel>Source Document</CardAttributeLabel>
                <CardAttributeValue>
                  <Enumerable
                    value={routeData?.receipt?.sourceDocument ?? null}
                  />
                </CardAttributeValue>
              </CardAttribute>
              <CardAttribute>
                <CardAttributeLabel>Source Document ID</CardAttributeLabel>
                <CardAttributeValue>
                  {routeData?.receipt?.sourceDocumentReadableId}
                </CardAttributeValue>
              </CardAttribute>
              <CardAttribute>
                <CardAttributeLabel>Posting Date</CardAttributeLabel>
                <CardAttributeValue>
                  {routeData?.receipt?.postingDate
                    ? formatDate(routeData?.receipt?.postingDate)
                    : "-"}
                </CardAttributeValue>
              </CardAttribute>
              <CardAttribute>
                <CardAttributeLabel>Status</CardAttributeLabel>
                <CardAttributeValue>
                  <ReceiptStatus status={routeData?.receipt?.status} />
                </CardAttributeValue>
              </CardAttribute>
            </CardAttributes>
          </CardContent>
        </Card>
      </VStack>
      {postingModal.isOpen && <ReceiptPostModal />}
    </>
  );
};

export default ReceiptHeader;
