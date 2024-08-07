import {
  Alert,
  Button,
  HStack,
  Menubar,
  MenubarItem,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  useDisclosure,
  VStack,
} from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
import { Link, useFetcher, useLocation, useParams } from "@remix-run/react";
import { useEffect } from "react";
import { LuDownload, LuUpload } from "react-icons/lu";
import { RiProgress4Line } from "react-icons/ri";
import { z } from "zod";
import { BreadcrumbItem, Breadcrumbs } from "~/components";
import { Hidden, Item, Submit } from "~/components/Form";
import type { Tree } from "~/components/TreeView";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { Quotation, QuotationLine, QuoteMethod } from "../../types";

const getMethodValidator = z.object({
  itemId: z.string().min(1, { message: "Please select a source method" }),
  quoteId: z.string(),
  quoteLineId: z.string(),
});

const QuoteBreadcrumbs = () => {
  const permissions = usePermissions();
  const { quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");

  const fetcher = useFetcher<{ error: string | null }>();
  const routeData = useRouteData<{
    quote: Quotation;
    lines: QuotationLine[];
    methods: Tree<QuoteMethod>[];
  }>(path.to.quote(quoteId));
  const line = routeData?.lines.find((line) => line.id === lineId);
  const { pathname } = useLocation();

  const methodTree = routeData?.methods.find(
    (m) => m.data.quoteLineId === line?.id
  );
  const hasMethods = methodTree?.children && methodTree.children.length > 0;

  const isGetMethodLoading =
    fetcher.state !== "idle" && fetcher.formAction === path.to.quoteMethodGet;

  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.data?.error]);

  const getMethodModal = useDisclosure();

  return (
    <>
      <Menubar>
        <HStack className="w-full justify-between">
          <Breadcrumbs>
            <BreadcrumbItem>
              <Button leftIcon={<RiProgress4Line />} variant="ghost" asChild>
                <Link to={path.to.quoteDetails(quoteId)}>
                  {routeData?.quote?.quoteId}
                </Link>
              </Button>
            </BreadcrumbItem>
            {line && (
              <BreadcrumbItem>
                <Button variant="ghost" asChild>
                  <Link to={path.to.quoteLine(quoteId, line.id!)}>
                    {line.itemReadableId}
                  </Link>
                </Button>
              </BreadcrumbItem>
            )}
          </Breadcrumbs>
          {line &&
            permissions.can("update", "sales") &&
            pathname === path.to.quoteLine(quoteId, lineId!) && (
              <HStack spacing={0}>
                <MenubarItem
                  leftIcon={<LuDownload />}
                  isLoading={isGetMethodLoading}
                  isDisabled={isGetMethodLoading}
                  onClick={getMethodModal.onOpen}
                >
                  Get Method
                </MenubarItem>
                <MenubarItem leftIcon={<LuUpload />}>Save Method</MenubarItem>
              </HStack>
            )}
        </HStack>
      </Menubar>
      {getMethodModal.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) {
              getMethodModal.onClose();
            }
          }}
        >
          <ModalContent>
            <ValidatedForm
              method="post"
              fetcher={fetcher}
              action={path.to.quoteMethodGet}
              validator={getMethodValidator}
              onSubmit={getMethodModal.onClose}
            >
              <ModalHeader>
                <ModalTitle>Get Method</ModalTitle>
                <ModalDescription>
                  Overwrite the quote method with the source method
                </ModalDescription>
              </ModalHeader>
              <ModalBody>
                <Hidden name="quoteId" value={quoteId} />
                <Hidden name="quoteLineId" value={lineId} />
                <VStack spacing={4}>
                  <Item
                    name="itemId"
                    label="Source Method"
                    type="Part"
                    replenishmentSystem="Make"
                  />
                  {hasMethods && (
                    <Alert variant="destructive">
                      This will overwrite the existing quote method
                    </Alert>
                  )}
                </VStack>
              </ModalBody>
              <ModalFooter>
                <Button onClick={getMethodModal.onClose} variant="secondary">
                  Cancel
                </Button>
                <Submit variant={hasMethods ? "destructive" : "primary"}>
                  Confirm
                </Submit>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}
    </>
  );
};

export default QuoteBreadcrumbs;
