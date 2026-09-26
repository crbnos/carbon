import {
  Badge,
  Button,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuCircleCheck,
  LuClipboardPen,
  LuEllipsisVertical,
  LuFile,
  LuLoaderCircle,
  LuShieldCheck,
  LuTrash,
  LuUserCheck
} from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import { Confirm } from "~/components/Modals";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions } from "~/hooks";
import type { FirstArticleInspectionDetail } from "~/modules/quality/types";
import { path } from "~/utils/path";
import { getInspectionStatusVariant } from "../Inspections/InspectionStatus";
import FirstArticleCustomerApprovalForm from "./FirstArticleCustomerApprovalForm";
import FirstArticleStatus from "./FirstArticleStatus";

const DISPOSITIONED = ["Passed", "Failed", "Partial"];

type FirstArticleHeaderProps = {
  detail: FirstArticleInspectionDetail;
  currentUserId: string;
};

const FirstArticleHeader = ({
  detail,
  currentUserId
}: FirstArticleHeaderProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const approveConfirm = useDisclosure();
  const deleteModal = useDisclosure();
  const customerApprovalModal = useDisclosure();

  const { firstArticle, lot } = detail;
  const id = firstArticle.id;
  const status = firstArticle.status;
  const canUpdate = permissions.can("update", "quality");
  const busy = fetcher.state !== "idle";
  const dispositioned = DISPOSITIONED.includes(lot.status);

  const post = (action: string) =>
    fetcher.submit({}, { method: "post", action });

  const partLabel =
    firstArticle.item?.readableIdWithRevision ?? firstArticle.partNumber;

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between gap-x-4 px-4 py-2 bg-card border-b border-border h-[var(--header-height)] overflow-x-auto scrollbar-hide">
        <VStack spacing={0}>
          <HStack>
            <Heading size="h4" className="flex items-center gap-2">
              <span>{lot.inspectionId}</span>
              <span className="text-muted-foreground font-normal">
                {partLabel}
              </span>
            </Heading>
            <FirstArticleStatus status={status} />
            <Badge variant={getInspectionStatusVariant(lot.status)}>
              {lot.status}
            </Badge>
            <Copy text={lot.inspectionId} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label={t`More options`}
                  icon={<LuEllipsisVertical />}
                  variant="secondary"
                  size="sm"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  disabled={status !== "Verified" || busy || !canUpdate}
                  onClick={() => post(path.to.firstArticleReopen(id))}
                >
                  <DropdownMenuIcon icon={<LuLoaderCircle />} />
                  <Trans>Reopen</Trans>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={status !== "Approved" || !canUpdate}
                  onClick={customerApprovalModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuUserCheck />} />
                  <Trans>Customer Approval</Trans>
                </DropdownMenuItem>
                <DropdownMenuItem
                  destructive
                  disabled={
                    status !== "Draft" ||
                    detail.hasMeasurements ||
                    !permissions.can("delete", "quality")
                  }
                  onClick={deleteModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete First Article</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </HStack>
        </VStack>

        <HStack>
          <Button leftIcon={<LuFile />} variant="secondary" asChild>
            <a
              target="_blank"
              href={path.to.file.firstArticle(id)}
              rel="noreferrer"
            >
              <Trans>Report</Trans>
            </a>
          </Button>
          <Button leftIcon={<LuClipboardPen />} variant="secondary" asChild>
            <Link to={path.to.inspection(lot.id)}>
              <Trans>Record Results</Trans>
            </Link>
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              {/* A disabled button swallows the pointer events the tooltip needs. */}
              <span>
                <Button
                  leftIcon={<LuCircleCheck />}
                  variant={status === "Draft" ? "primary" : "secondary"}
                  isDisabled={
                    status !== "Draft" || !dispositioned || busy || !canUpdate
                  }
                  isLoading={
                    busy &&
                    fetcher.formAction === path.to.firstArticleVerify(id)
                  }
                  onClick={() => post(path.to.firstArticleVerify(id))}
                >
                  <Trans>Verify</Trans>
                </Button>
              </span>
            </TooltipTrigger>
            {status === "Draft" && !dispositioned && (
              <TooltipContent>
                <Trans>Disposition the inspection before verifying</Trans>
              </TooltipContent>
            )}
          </Tooltip>
          <Button
            leftIcon={<LuShieldCheck />}
            variant={status === "Verified" ? "primary" : "secondary"}
            isDisabled={status !== "Verified" || busy || !canUpdate}
            isLoading={
              busy && fetcher.formAction === path.to.firstArticleApprove(id)
            }
            onClick={() => {
              if (firstArticle.verifiedBy === currentUserId) {
                approveConfirm.onOpen();
              } else {
                post(path.to.firstArticleApprove(id));
              }
            }}
          >
            <Trans>Approve</Trans>
          </Button>
        </HStack>
      </div>

      {approveConfirm.isOpen && (
        <Confirm
          action={path.to.firstArticleApprove(id)}
          title={t`Approve first article?`}
          text={t`You verified this first article. AS9102 recommends a different approver. Approve anyway?`}
          confirmText={t`Approve`}
          onCancel={approveConfirm.onClose}
          onSubmit={approveConfirm.onClose}
        />
      )}

      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteFirstArticle(id)}
          isOpen={deleteModal.isOpen}
          name={lot.inspectionId}
          text={t`Are you sure you want to delete ${lot.inspectionId}? Its inspection is deleted with it. This cannot be undone.`}
          onCancel={deleteModal.onClose}
          onSubmit={deleteModal.onClose}
        />
      )}

      {customerApprovalModal.isOpen && (
        <FirstArticleCustomerApprovalForm
          initialValues={{
            id,
            customerApprovalName: firstArticle.customerApprovalName ?? "",
            customerApprovalDate: firstArticle.customerApprovalDate ?? ""
          }}
          onClose={customerApprovalModal.onClose}
        />
      )}
    </>
  );
};

export default FirstArticleHeader;
