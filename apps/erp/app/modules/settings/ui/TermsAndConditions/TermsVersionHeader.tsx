import { getDocumentLabel } from "@carbon/documents/template";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  VStack
} from "@carbon/react";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuEllipsisVertical, LuPanelRight, LuTrash } from "react-icons/lu";
import { useNavigate, useParams } from "react-router";
import { usePanels } from "~/components/Layout";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { TermsVersion } from "../../types";
import { useTermsVersionEditor } from "./TermsVersionEditorContext";

const TermsVersionHeader = () => {
  const { id } = useParams();
  const { t } = useLingui();
  if (!id) throw new Error("id not found");

  const navigate = useNavigate();
  const permissions = usePermissions();
  const { toggleProperties } = usePanels();
  const { isDirty, isSaving, save } = useTermsVersionEditor();

  const routeData = useRouteData<{ termsVersion: TermsVersion }>(
    path.to.termsVersion(id)
  );
  const termsVersion = routeData?.termsVersion;

  // Display-only; resolution itself compares against each document's own date.
  const currentDate = today(getLocalTimeZone()).toString();
  const status = () => {
    if (!termsVersion) return null;
    if (!termsVersion.active)
      return { label: t`Inactive`, variant: "outline" as const };
    if (termsVersion.effectiveFrom && termsVersion.effectiveFrom > currentDate)
      return { label: t`Scheduled`, variant: "secondary" as const };
    if (termsVersion.effectiveTo && termsVersion.effectiveTo < currentDate)
      return { label: t`Expired`, variant: "destructive" as const };
    return { label: t`Active now`, variant: "green" as const };
  };
  const badge = status();

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[var(--header-height)] overflow-x-auto scrollbar-hide">
      <VStack spacing={0} className="flex-grow">
        <HStack spacing={2}>
          <Heading size="h4" className="truncate">
            {termsVersion?.name}
          </Heading>
          {termsVersion?.documentTypes?.map((documentType) => (
            <Badge key={documentType} variant="secondary">
              {getDocumentLabel(documentType)}
            </Badge>
          ))}
          {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
        </HStack>
      </VStack>
      <HStack spacing={1}>
        {permissions.can("update", "settings") && (
          <Button
            onClick={save}
            isDisabled={!isDirty}
            isLoading={isSaving}
            variant={isDirty ? "primary" : "secondary"}
          >
            {isDirty ? <Trans>Save</Trans> : <Trans>Saved</Trans>}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              aria-label={t`More`}
              icon={<LuEllipsisVertical />}
              variant="ghost"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={!permissions.can("delete", "settings")}
              onClick={() => navigate(path.to.deleteTermsVersion(id))}
            >
              <DropdownMenuIcon icon={<LuTrash />} />
              <Trans>Delete</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton
          aria-label={t`Toggle Properties`}
          icon={<LuPanelRight />}
          onClick={toggleProperties}
          variant="ghost"
        />
      </HStack>
    </div>
  );
};

export default TermsVersionHeader;
