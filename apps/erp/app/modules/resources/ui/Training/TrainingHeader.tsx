import {
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
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuEllipsisVertical,
  LuPanelLeft,
  LuPanelRight,
  LuTrash
} from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { usePanels } from "~/components/Layout";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData } from "~/hooks";
import type { Training } from "~/modules/resources";
import { path } from "~/utils/path";
import TrainingStatus from "./TrainingStatus";

const TrainingHeader = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    training: Training;
  }>(path.to.training(id));

  const { t } = useLingui();
  const permissions = usePermissions();
  const { toggleExplorer, toggleProperties } = usePanels();
  const deleteDisclosure = useDisclosure();

  const publishFetcher = useFetcher<{}>();
  const status = routeData?.training?.status;
  const isDraft = status === "Draft";
  const isPublishing = publishFetcher.state !== "idle";

  const onPublish = () => {
    const formData = new FormData();
    formData.append("ids", id);
    formData.append("field", "status");
    formData.append("value", "Active");
    publishFetcher.submit(formData, {
      method: "post",
      action: path.to.bulkUpdateTraining
    });
  };

  return (
    <div className="flex flex-shrink-0 items-center justify-between gap-x-4 px-4 py-2 bg-card border-b border-border h-[var(--header-height)] overflow-x-auto scrollbar-hide">
      <VStack spacing={0} className="flex-grow">
        <HStack>
          <IconButton
            aria-label={t`Toggle Explorer`}
            icon={<LuPanelLeft />}
            onClick={toggleExplorer}
            variant="ghost"
          />
          <Heading size="h4" className="flex items-center gap-2">
            <span>{routeData?.training?.name}</span>
            {/* @ts-expect-error TS2322 */}
            <TrainingStatus status={routeData?.training?.status} />
          </Heading>
          <Copy text={routeData?.training?.name ?? ""} />
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
                disabled={
                  !permissions.can("delete", "resources") ||
                  !permissions.is("employee")
                }
                destructive
                onClick={deleteDisclosure.onOpen}
              >
                <DropdownMenuIcon icon={<LuTrash />} />
                <Trans>Delete Training</Trans>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </HStack>
      </VStack>
      <div className="flex flex-shrink-0 gap-2 items-center justify-end">
        {isDraft && (
          <Button
            isDisabled={!permissions.can("update", "people") || isPublishing}
            isLoading={isPublishing}
            onClick={onPublish}
          >
            <Trans>Publish</Trans>
          </Button>
        )}
        <IconButton
          aria-label={t`Toggle Properties`}
          icon={<LuPanelRight />}
          onClick={toggleProperties}
          variant="ghost"
        />
      </div>
      {deleteDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteTraining(id)}
          isOpen={deleteDisclosure.isOpen}
          name={routeData?.training?.name ?? "training"}
          text={t`Are you sure you want to delete ${routeData?.training?.name}? This cannot be undone.`}
          onCancel={() => {
            deleteDisclosure.onClose();
          }}
          onSubmit={() => {
            deleteDisclosure.onClose();
          }}
        />
      )}
    </div>
  );
};

export default TrainingHeader;
