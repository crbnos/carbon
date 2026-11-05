// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
  Count,
  generateHTML,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useDebounce
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Trans } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { useCallback, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { ProcedureStepTypeIcon } from "~/components/Icons";
import { MeasurementLimits } from "~/components/MeasurementLimits";
import { useImageUpload, useUrlParams, useUser } from "~/hooks";
import type { getProcedure } from "~/modules/production/production.service";
import type { OperationStep } from "~/modules/shared/types";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { PartMethodPage } from "../../items.service";
import type {
  OperationItem,
  PendingWorkInstructions,
  TemporaryOperations
} from "./BillOfProcess";
import {
  AttributesForm,
  initialOperation,
  makeOperationItem,
  OperationForm,
  OperationPreview,
  ParametersForm,
  ToolsForm
} from "./BillOfProcess";
import {
  MethodLineNav,
  useMethodAccess,
  useMethodConfigurator
} from "./MethodPageFrame";
import { getMethodSearch, getOperationTabSources } from "./methodPageUtils";

type Procedure = NonNullable<Awaited<ReturnType<typeof getProcedure>>["data"]>;

const TABS = [
  "details",
  "instructions",
  "parameters",
  "steps",
  "tools",
  "preview"
] as const;
type OperationTab = (typeof TABS)[number];

const noop = () => {};

export function OperationWorkspace({
  itemId,
  page,
  operationId,
  procedure
}: {
  itemId: string;
  page: PartMethodPage;
  /** Omit it to add a new operation. */
  operationId?: string;
  procedure?: Procedure | null;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const search = getMethodSearch(location.search);
  const [params, setParams] = useUrlParams();
  const { isReadOnly } = useMethodAccess(page);
  const { onConfigure, rulesByField, editor } = useMethodConfigurator(page);
  const [allItems] = useItems();

  const operations = [...page.methodOperations].sort(
    (a, b) => a.order - b.order
  );
  const saved = operations.find((operation) => operation.id === operationId);
  const isNew = !operationId;

  const [newOperationId] = useState(() => nanoid());
  const item = makeOperationItem(
    (saved ?? {
      ...initialOperation,
      id: newOperationId,
      makeMethodId: page.makeMethod.id,
      order: Math.max(0, ...operations.map((o) => o.order)) + 1
    }) as unknown as OperationItem["data"],
    []
  );
  const steps = (saved?.methodOperationStep ??
    []) as unknown as OperationStep[];
  const tools = saved?.methodOperationTool ?? [];
  const parameters = saved?.methodOperationParameter ?? [];
  const sources = getOperationTabSources(item.data);
  const {
    methodOperationStep,
    methodOperationTool,
    methodOperationParameter,
    ...savedFields
  } = saved ?? {};
  const operationFormKey = JSON.stringify(savedFields);
  const temporaryItems: TemporaryOperations = isNew
    ? { [item.id]: item.data }
    : {};

  const materialItemIds = new Set(page.methodMaterials.map((m) => m.itemId));
  const itemMentions = allItems
    .filter((option) => materialItemIds.has(option.id))
    .map((option) => ({
      id: option.id,
      label: option.name ?? option.readableIdWithRevision,
      helper: option.name ? option.readableIdWithRevision : undefined
    }));

  const [workInstructions, setWorkInstructions] =
    useState<PendingWorkInstructions>(() => ({
      [item.id]: (item.data.workInstruction ?? {}) as JSONContent
    }));

  // The form stays mounted and re-runs its save effect when this changes.
  const onSubmit = useCallback(
    (savedId?: string) => {
      if (isNew && savedId) {
        navigate(
          `${path.to.partBillOfProcessOperation(itemId, savedId)}${search}`
        );
      }
    },
    [isNew, itemId, navigate, search]
  );

  // Deleted, a changed version, or a read-only method with nothing to add to.
  if (isNew ? isReadOnly : !saved) {
    return (
      <Navigate replace to={`${path.to.partBillOfProcess(itemId)}${search}`} />
    );
  }

  const requested = params.get("tab") as OperationTab | null;
  const tab: OperationTab =
    !isNew && requested && TABS.includes(requested) ? requested : "details";

  const linkedDocument = item.data.assemblyInstructionId
    ? {
        label: <Trans>Assembly Instruction</Trans>,
        to: path.to.assemblyInstruction(item.data.assemblyInstructionId)
      }
    : item.data.inspectionDocumentId
      ? {
          label: <Trans>Inspection Plan</Trans>,
          to: path.to.inspectionDocument(item.data.inspectionDocumentId)
        }
      : null;

  return (
    <div className="flex w-full flex-col gap-4 p-4">
      <MethodLineNav
        page={page}
        backLabel={<Trans>Bill of Process</Trans>}
        backTo={path.to.partBillOfProcess(itemId)}
        title={isNew ? <Trans>New Operation</Trans> : item.data.description}
        lineIds={operations.map((operation) => operation.id!)}
        currentId={item.id}
        getLinePath={(id) => path.to.partBillOfProcessOperation(itemId, id)}
      />

      <Tabs
        value={tab}
        onValueChange={(value) => setParams({ tab: value })}
        className="w-full"
      >
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="details">
            <Trans>Details</Trans>
          </TabsTrigger>
          <TabsTrigger value="instructions" disabled={isNew}>
            <Trans>Instructions</Trans>
          </TabsTrigger>
          <TabsTrigger value="parameters" disabled={isNew}>
            <span className="flex items-center gap-2">
              <Trans>Parameters</Trans>
              {sources.parameters === "own" && parameters.length > 0 && (
                <Count count={parameters.length} />
              )}
            </span>
          </TabsTrigger>
          <TabsTrigger value="steps" disabled={isNew}>
            <span className="flex items-center gap-2">
              <Trans>Steps</Trans>
              {sources.steps === "own" && steps.length > 0 && (
                <Count count={steps.length} />
              )}
            </span>
          </TabsTrigger>
          <TabsTrigger value="tools" disabled={isNew}>
            <span className="flex items-center gap-2">
              <Trans>Tools</Trans>
              {sources.tools === "own" && tools.length > 0 && (
                <Count count={tools.length} />
              )}
            </span>
          </TabsTrigger>
          <TabsTrigger value="preview" disabled={isNew}>
            <Trans>Preview</Trans>
          </TabsTrigger>
        </TabsList>

        <TabPanel value="details">
          <Purpose>
            <Trans>
              What this operation is, where it runs and how long it takes.
              Scheduling and costing use these values.
            </Trans>
          </Purpose>
          <OperationForm
            // A new form after a save: what it holds is now what is saved.
            key={operationFormKey}
            isReadOnly={isReadOnly}
            configurable={page.configurable}
            item={item}
            itemId={page.makeMethod.itemId}
            rulesByField={rulesByField}
            workInstruction={workInstructions[item.id] ?? {}}
            temporaryItems={temporaryItems}
            onConfigure={onConfigure}
            setSelectedItemId={noop}
            setTemporaryItems={noop}
            setWorkInstructions={setWorkInstructions}
            onSubmit={onSubmit}
          />
        </TabPanel>

        {!isNew && (
          <>
            <TabPanel value="instructions">
              <Purpose>
                <Trans>Text the operator reads while working.</Trans>
              </Purpose>
              {sources.instructions === "notUsed" ? (
                <NotUsedNotice />
              ) : sources.instructions === "procedure" ? (
                <ProcedureNotice procedure={procedure}>
                  {procedure?.content ? (
                    <div
                      className="prose dark:prose-invert"
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: generateHTML renders our own editor document
                      dangerouslySetInnerHTML={{
                        __html: generateHTML(procedure.content as JSONContent)
                      }}
                    />
                  ) : null}
                </ProcedureNotice>
              ) : (
                <OperationInstructions
                  operationId={item.id}
                  isReadOnly={isReadOnly}
                  value={workInstructions[item.id] ?? {}}
                  mentions={itemMentions}
                  onChange={(content) =>
                    setWorkInstructions((prev) => ({
                      ...prev,
                      [item.id]: content
                    }))
                  }
                />
              )}
            </TabPanel>

            <TabPanel value="parameters">
              <Purpose>
                <Trans>
                  Settings the operator reads but does not fill in. To make the
                  operator record a value, add a Measurement step.
                </Trans>
              </Purpose>
              {sources.parameters === "notUsed" ? (
                <NotUsedNotice />
              ) : sources.parameters === "procedure" ? (
                <ProcedureNotice procedure={procedure}>
                  <ProcedureParameters procedure={procedure} />
                </ProcedureNotice>
              ) : (
                <ParametersForm
                  parameters={parameters}
                  operationId={item.id}
                  temporaryItems={temporaryItems}
                  isDisabled={isReadOnly}
                  configurable={page.configurable}
                  rulesByField={rulesByField}
                  onConfigure={onConfigure}
                />
              )}
            </TabPanel>

            <TabPanel value="steps">
              <Purpose>
                <Trans>What the operator does and records, in order.</Trans>
              </Purpose>
              {sources.steps === "notUsed" ? (
                <NotUsedNotice />
              ) : sources.steps === "procedure" ? (
                <ProcedureNotice procedure={procedure}>
                  <ProcedureSteps procedure={procedure} />
                </ProcedureNotice>
              ) : sources.steps === "linked" ? (
                <LinkedDocumentNotice document={linkedDocument} />
              ) : (
                <AttributesForm
                  steps={steps}
                  tools={tools}
                  materials={page.methodMaterials}
                  operationId={item.id}
                  temporaryItems={temporaryItems}
                  isDisabled={isReadOnly}
                  configurable={page.configurable}
                  rulesByField={rulesByField}
                  onConfigure={onConfigure}
                  itemMentions={itemMentions}
                />
              )}
            </TabPanel>

            <TabPanel value="tools">
              <Purpose>
                <Trans>
                  Tools the operator needs. A tool linked to steps shows on
                  those steps; otherwise it shows on every step. Operators see
                  tools in the Assembly view.
                </Trans>
              </Purpose>
              {sources.tools === "notUsed" ? (
                <NotUsedNotice />
              ) : (
                <ToolsForm
                  tools={tools}
                  operationId={item.id}
                  temporaryItems={temporaryItems}
                  isDisabled={isReadOnly}
                />
              )}
            </TabPanel>

            <TabPanel value="preview">
              <Purpose>
                <Trans>
                  What the operator sees for this operation in the Assembly
                  view.
                </Trans>
              </Purpose>
              {sources.preview === "notUsed" ? (
                <NotUsedNotice />
              ) : sources.preview === "procedure" ? (
                <ProcedureNotice procedure={procedure} />
              ) : sources.preview === "linked" ? (
                <LinkedDocumentNotice document={linkedDocument} />
              ) : (
                <OperationPreview steps={steps} tools={tools} />
              )}
            </TabPanel>
          </>
        )}
      </Tabs>

      {editor}
    </div>
  );
}

function TabPanel({
  value,
  children
}: {
  value: OperationTab;
  children: React.ReactNode;
}) {
  return (
    <TabsContent value={value} className="mt-4 w-full">
      <Card>
        <CardContent className="pt-6">{children}</CardContent>
      </Card>
    </TabsContent>
  );
}

function Purpose({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-sm text-muted-foreground">{children}</p>;
}

function NotUsedNotice() {
  return (
    <p className="text-sm">
      <Trans>
        Outside Processing does not use this. A supplier does the work, so
        operators never see this operation. Change Operation Type in Details to
        use it.
      </Trans>
    </p>
  );
}

function ProcedureNotice({
  procedure,
  children
}: {
  procedure?: Procedure | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        <Trans>
          This comes from the procedure and is copied onto each new job. It is
          read-only here.
        </Trans>{" "}
        {procedure && (
          <Link
            to={path.to.procedure(procedure.id)}
            className="font-medium underline underline-offset-2"
          >
            {procedure.name}
          </Link>
        )}
      </p>
      {children}
    </div>
  );
}

function LinkedDocumentNotice({
  document
}: {
  document: { label: React.ReactNode; to: string } | null;
}) {
  return (
    <p className="text-sm">
      <Trans>This comes from a linked document.</Trans>{" "}
      {document && (
        <Link
          to={document.to}
          className="font-medium underline underline-offset-2"
        >
          {document.label}
        </Link>
      )}
    </p>
  );
}

function ProcedureSteps({ procedure }: { procedure?: Procedure | null }) {
  const steps = [...(procedure?.procedureStep ?? [])].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  );
  return (
    <div className="flex w-full flex-col divide-y divide-border">
      {steps.map((step) => (
        <div key={step.id} className="flex items-center gap-3 py-2 text-sm">
          <ProcedureStepTypeIcon type={step.type} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{step.name}</span>
            <span className="text-xs text-muted-foreground">{step.type}</span>
            {step.type === "Measurement" && (
              <MeasurementLimits
                minValue={step.minValue}
                maxValue={step.maxValue}
                unit={step.unitOfMeasureCode ?? undefined}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProcedureParameters({ procedure }: { procedure?: Procedure | null }) {
  const parameters = procedure?.procedureParameter ?? [];
  if (parameters.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        <Trans>This procedure has no parameters.</Trans>
      </p>
    );
  }
  return (
    <Table full>
      <Thead>
        <Tr>
          <Th>
            <Trans>Key</Trans>
          </Th>
          <Th>
            <Trans>Value</Trans>
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {parameters.map((parameter) => (
          <Tr key={parameter.id}>
            <Td>{parameter.key}</Td>
            <Td>{parameter.value}</Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}

/** The editor from the Instructions tab of the card editor: it saves as you type. */
function OperationInstructions({
  operationId,
  isReadOnly,
  value,
  mentions,
  onChange
}: {
  operationId: string;
  isReadOnly: boolean;
  value: JSONContent;
  mentions: { id: string; label: string; helper?: string }[];
  onChange: (content: JSONContent) => void;
}) {
  const { carbon } = useCarbon();
  const { id: userId } = useUser();
  const onUploadImage = useImageUpload(`parts/${operationId}`);

  const save = useDebounce(
    async (content: JSONContent) => {
      await carbon
        ?.from("methodOperation")
        .update({
          workInstruction: content,
          updatedAt: today(getLocalTimeZone()).toString(),
          updatedBy: userId
        })
        .eq("id", operationId);
    },
    1000,
    true
  );

  if (isReadOnly) {
    return (
      <div
        className="prose dark:prose-invert"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: generateHTML renders our own editor document
        dangerouslySetInnerHTML={{ __html: generateHTML(value) }}
      />
    );
  }

  return (
    <Editor
      initialValue={value}
      onUpload={onUploadImage}
      onChange={(content) => {
        onChange(content);
        save(content);
      }}
      mentions={[{ char: "@", items: mentions }]}
      className="py-8"
    />
  );
}
