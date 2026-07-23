import { ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuPlus } from "react-icons/lu";
import { Hyperlink } from "~/components";
import { Hidden, InspectionDocument, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import InspectionDocumentForm from "~/modules/production/ui/InspectionDocument/InspectionDocumentForm";
import {
  inspectionDocumentUsages,
  itemInspectionDocumentAssignmentValidator
} from "~/modules/quality";
import type { SamplingStandard } from "~/modules/quality/samplingStandards";
import type { ItemInspectionDocumentAssignment } from "~/modules/quality/types";
import { path } from "~/utils/path";
import SamplingPlanForm from "./SamplingPlanForm";

type ItemQualityViewProps = {
  itemId: string;
  actionPath: string;
  standard: SamplingStandard;
  plan: Parameters<typeof SamplingPlanForm>[0]["initial"];
  documents: {
    id: string;
    fileName: string | null;
    drawingNumber: string | null;
    version: number;
  }[];
  assignments: ItemInspectionDocumentAssignment[];
};

// The item Quality tab: the item's inspection documents, the usage-slot
// assignments driving which document each inspection flow uses (v1: Receipt
// for inbound inspection; FAI / Production slots are additive later), and the
// item-level sampling plan.
const ItemQualityView = ({
  itemId,
  actionPath,
  standard,
  plan,
  documents,
  assignments
}: ItemQualityViewProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "quality");
  const newDocumentDisclosure = useDisclosure();

  return (
    <VStack spacing={4} className="w-full">
      <Card>
        <HStack className="w-full justify-between items-start">
          <CardHeader>
            <CardTitle>
              <Trans>Inspection Plans</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>Ballooned drawings with inspection characteristics.</Trans>
            </CardDescription>
          </CardHeader>
          <CardAction>
            {permissions.can("create", "quality") && (
              <Button
                variant="secondary"
                leftIcon={<LuPlus />}
                onClick={newDocumentDisclosure.onOpen}
              >
                <Trans>New</Trans>
              </Button>
            )}
          </CardAction>
        </HStack>
        <CardContent>
          {documents.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              <Trans>No inspection plans</Trans>
            </p>
          ) : (
            <VStack spacing={0} className="w-full">
              {documents.map((doc) => (
                <HStack
                  key={doc.id}
                  className="w-full justify-between border-b py-2 last:border-b-0"
                >
                  <Hyperlink to={path.to.inspectionDocument(doc.id)}>
                    <span className="text-sm font-medium">
                      {doc.drawingNumber ?? doc.fileName ?? doc.id}
                    </span>
                  </Hyperlink>
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    v{doc.version}
                  </Badge>
                </HStack>
              ))}
            </VStack>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Inspection Plan Assignments</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Which document drives each inspection flow for this item.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VStack spacing={4} className="w-full">
            {inspectionDocumentUsages.map((usage) => {
              const assignment = assignments.find((a) => a.usage === usage);
              return (
                <ValidatedForm
                  key={usage}
                  method="post"
                  action={actionPath}
                  validator={itemInspectionDocumentAssignmentValidator}
                  defaultValues={{
                    itemId,
                    usage,
                    inspectionDocumentId: assignment?.inspectionDocumentId ?? ""
                  }}
                  className="w-full"
                >
                  <Hidden name="intent" value="assignment" />
                  <Hidden name="itemId" value={itemId} />
                  <Hidden name="usage" value={usage} />
                  <HStack className="w-full items-end gap-4">
                    <div className="flex-1">
                      <InspectionDocument
                        name="inspectionDocumentId"
                        label={usage === "Receipt" ? t`Receipt` : usage}
                        itemId={itemId}
                        isOptional
                      />
                    </div>
                    <Submit isDisabled={!canUpdate} variant="secondary">
                      <Trans>Save</Trans>
                    </Submit>
                  </HStack>
                </ValidatedForm>
              );
            })}
          </VStack>
        </CardContent>
      </Card>

      <SamplingPlanForm
        action={actionPath}
        itemId={itemId}
        standard={standard}
        initial={plan}
      />

      {newDocumentDisclosure.isOpen && (
        <InspectionDocumentForm
          initialValues={{ name: "", partId: itemId, drawingNumber: "" }}
          onClose={newDocumentDisclosure.onClose}
        />
      )}
    </VStack>
  );
};

export default ItemQualityView;
