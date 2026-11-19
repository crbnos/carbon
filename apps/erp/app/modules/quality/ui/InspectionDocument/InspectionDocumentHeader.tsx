// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Input,
  MENU_ITEM_SHORTCUTS,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import {
  LuEllipsisVertical,
  LuExternalLink,
  LuFileDown,
  LuTrash2,
  LuUpload
} from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import { VersionMenu } from "~/components/VersionMenu";
import { usePermissions } from "~/hooks";
import type { InspectionDocumentStatus } from "~/modules/quality/quality.models";
import { path } from "~/utils/path";
import QualityDocumentStatus from "../Documents/QualityDocumentStatus";

export type EditorTab = "characteristics" | "parameters" | "instructions";

export type InspectionDocumentVersion = {
  id: string;
  name: string | null;
  fileName: string | null;
  version: number;
  status: InspectionDocumentStatus;
};

type InspectionDocumentHeaderProps = {
  diagramId: string;
  title: string;
  onTitleChange: (value: string) => void;
  /** Update permission on a Draft version. */
  canUpdate: boolean;
  /** An Active or Archived version. */
  isLocked: boolean;
  itemMasterLink: string | null;
  hasPdf: boolean;
  uploading: boolean;
  onReplacePdf: () => void;
  pdfExporting: boolean;
  onDownloadPdf: () => void;
  onDelete: () => void;
  tab: EditorTab;
  onTabChange: (tab: EditorTab) => void;
  saveFailed: boolean;
  /** An edit not saved yet, or a save in flight. */
  saving: boolean;
  hasSaved: boolean;
  version: number;
  versions: InspectionDocumentVersion[];
  status: InspectionDocumentStatus;
  /** Publishing locks the version, so it waits for every edit to land. */
  hasPendingEdits: boolean;
};

/**
 * The plan editor's header: the name and its ⋮ menu, the Characteristics /
 * Parameters / Instructions tabs, the save status, the version menu and
 * Publish (Draft) or Reactivate (Archived).
 */
export default function InspectionDocumentHeader({
  diagramId,
  title,
  onTitleChange,
  canUpdate,
  isLocked,
  itemMasterLink,
  hasPdf,
  uploading,
  onReplacePdf,
  pdfExporting,
  onDownloadPdf,
  onDelete,
  tab,
  onTabChange,
  saveFailed,
  saving,
  hasSaved,
  version,
  versions,
  status,
  hasPendingEdits
}: InspectionDocumentHeaderProps) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const newVersionFetcher = useFetcher();
  const activateFetcher = useAction({
    onSuccess: () => toast.success(t`Version published`)
  });

  return (
    // Header bar — min-height only so controls are not clipped when the row wraps
    <div className="grid min-h-[var(--header-height)] flex-shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-x-3 gap-y-2 overflow-x-auto border-b border-border bg-card px-4 py-2 scrollbar-hide">
      <div className="flex min-w-0 items-center gap-1 pr-2">
        <Input
          aria-label={t`Diagram title`}
          borderless
          value={title}
          placeholder={t`Untitled Diagram`}
          className="field-sizing-content w-auto min-w-[6rem] max-w-[28rem] font-semibold text-base truncate"
          readOnly={!canUpdate}
          onChange={(e) => onTitleChange(e.target.value)}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              type="button"
              variant="outline"
              size="sm"
              aria-label={t`More actions`}
              icon={<LuEllipsisVertical />}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            <DropdownMenuItem
              shortcut={MENU_ITEM_SHORTCUTS.view}
              disabled={!itemMasterLink}
              onClick={() => {
                if (itemMasterLink) navigate(itemMasterLink);
              }}
            >
              <LuExternalLink className="mr-2 size-4" />
              {t`View Item Master`}
            </DropdownMenuItem>
            {hasPdf && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={uploading || !canUpdate}
                  onClick={onReplacePdf}
                >
                  <LuUpload className="mr-2 size-4" />
                  {uploading ? t`Uploading…` : t`Replace PDF`}
                </DropdownMenuItem>
                <DropdownMenuItem
                  shortcut={MENU_ITEM_SHORTCUTS.download}
                  disabled={pdfExporting}
                  onClick={onDownloadPdf}
                >
                  <LuFileDown className="mr-2 size-4" />
                  {t`Download PDF`}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              shortcut={MENU_ITEM_SHORTCUTS.delete}
              destructive
              disabled={!permissions.can("delete", "quality")}
              onClick={onDelete}
            >
              <LuTrash2 className="mr-2 size-4" />
              {t`Delete Inspection Plan`}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as EditorTab)}
        className="justify-self-center"
      >
        <TabsList className="max-md:w-auto max-md:px-0">
          <TabsTrigger value="characteristics">{t`Characteristics`}</TabsTrigger>
          <TabsTrigger value="parameters">{t`Parameters`}</TabsTrigger>
          <TabsTrigger value="instructions">{t`Instructions`}</TabsTrigger>
        </TabsList>
      </Tabs>
      <HStack spacing={2} className="justify-end justify-self-end">
        {isLocked ? (
          <span className="text-xs text-muted-foreground">
            {t`Make a new version to change this plan`}
          </span>
        ) : !canUpdate ? (
          <span className="text-xs text-muted-foreground">
            {t`View only — changes are not saved`}
          </span>
        ) : saveFailed ? (
          <span className="text-xs text-destructive">{t`Could not save`}</span>
        ) : saving ? (
          <span className="text-xs text-muted-foreground">{t`Saving…`}</span>
        ) : hasSaved ? (
          <span className="text-xs text-muted-foreground">{t`Saved`}</span>
        ) : null}
        <div className="flex shrink-0 items-center gap-1">
          <VersionMenu
            variant="secondary"
            label={`V${version}`}
            versions={versions}
            currentVersionId={diagramId}
            getKey={(v) => v.id}
            getHref={(v) => path.to.inspectionDocument(v.id)}
            renderLabel={(v) => (
              <>
                <Badge variant="outline">V{v.version}</Badge>
                <span>{v.name ?? v.fileName}</span>
              </>
            )}
            renderStatus={(v) => <QualityDocumentStatus status={v.status} />}
            isNewVersionDisabled={newVersionFetcher.state !== "idle"}
            onNewVersion={
              permissions.can("create", "quality")
                ? () =>
                    newVersionFetcher.submit(
                      {},
                      {
                        method: "post",
                        action: path.to.inspectionDocumentVersion(diagramId)
                      }
                    )
                : undefined
            }
          />
          {status !== "Draft" && <QualityDocumentStatus status={status} />}
          {status !== "Active" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  isLoading={activateFetcher.state !== "idle"}
                  isDisabled={
                    !permissions.can("update", "quality") ||
                    activateFetcher.state !== "idle" ||
                    hasPendingEdits
                  }
                  onClick={() =>
                    activateFetcher.submit(
                      {},
                      {
                        method: "post",
                        action: path.to.inspectionDocumentActivate(diagramId)
                      }
                    )
                  }
                >
                  {status === "Archived" ? t`Reactivate` : t`Publish`}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {hasPendingEdits
                  ? t`Publish once your changes are saved.`
                  : status === "Archived"
                    ? t`Makes this version Active again and archives the Active version.`
                    : t`This version is a Draft. Publishing makes it Active and archives the Active version.`}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </HStack>
    </div>
  );
}
