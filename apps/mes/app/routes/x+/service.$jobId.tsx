// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { Json } from "@carbon/database";
import { getCompanyTimeZone } from "@carbon/database";
import { getDocumentType, storage } from "@carbon/files";
import { getLogger } from "@carbon/logger";
import { useAction, useRevalidator } from "@carbon/query";
import type { JSONContent } from "@carbon/react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  cn,
  DropdownMenuIcon,
  DropdownMenuItem,
  Heading,
  IconButton,
  isRichTextEmpty,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  RichTextView,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  ToggleGroup,
  ToggleGroupItem,
  Tr,
  toast,
  useDebounce,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import {
  datetime,
  formatQuantity,
  isServiceJobLocked,
  redirect,
  stripSpecialCharacters
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { nanoid } from "nanoid";
import { useMemo, useState } from "react";
import { FaCheck } from "react-icons/fa6";
import {
  LuBarcode,
  LuCalendarClock,
  LuCheck,
  LuCirclePlus,
  LuClock,
  LuExternalLink,
  LuMapPin,
  LuShieldCheck,
  LuSquareUser,
  LuTimer,
  LuTriangleAlert,
  LuX
} from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Link, useFetcher, useLoaderData } from "react-router";
import { DateTime } from "~/components";
import EmployeeAvatar from "~/components/EmployeeAvatar";
import FileDropzone from "~/components/FileDropzone";
import {
  IconButtonWithTooltip,
  PauseButton,
  PlayButton
} from "~/components/JobOperation/components/Controls";
import {
  CoverageBadge,
  ServiceJobAddPartModal,
  ServiceJobStatus,
  ServicePriorityIcon,
  useWorkSiteLabels,
  WarrantyBadge
} from "~/components/ServiceJob";
import {
  WorkRecordChip,
  WorkRecordDock,
  WorkRecordPane,
  WorkRecordSection,
  WorkRecordShell,
  WorkRecordStat,
  WorkRecordStats,
  WorkRecordTablePanel,
  WorkRecordTitle
} from "~/components/WorkRecord";
import { useImageUpload, useUser } from "~/hooks";
import { erpPosting } from "~/services/erp";
import {
  getRunningServiceClock,
  getServiceJob,
  getServiceJobFiles,
  getServiceJobItems,
  getServiceJobTime,
  getServiceLaborRates,
  type ServiceJobTechnicianUpdate,
  updateServiceJobFields
} from "~/services/service.service";
import { useItems } from "~/stores";
import type { Handle } from "~/utils/handle";
import { getPrivateUrl, path } from "~/utils/path";

const log = getLogger("mes", "service-job");

export const handle: Handle = {
  realtime: [{ table: "serviceJob", column: "id", param: "jobId" }]
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});
  const { jobId } = params;
  if (!jobId) throw new Error("Service job is required");

  const [job, time, items, files, runningClock, timeZone, laborRates] =
    await Promise.all([
      getServiceJob(client, companyId, jobId),
      getServiceJobTime(client, companyId, jobId),
      getServiceJobItems(client, companyId, jobId),
      getServiceJobFiles(client, companyId, jobId),
      getRunningServiceClock(client, { employeeId: userId, companyId }),
      getCompanyTimeZone(client, companyId),
      getServiceLaborRates(client, companyId)
    ]);

  if (!job.data || job.data.companyId !== companyId) {
    throw redirect(
      path.to.service,
      await flash(request, error(job.error, "Service job not found"))
    );
  }

  return {
    job: job.data,
    time: time.data ?? [],
    items: items.data ?? [],
    // A signature captured before signatures were removed is not a photo.
    files: (files.data ?? []).filter((file) => file.name !== "signature.png"),
    runningClock: runningClock.data,
    laborCostRate: laborRates.data.costRate,
    today: datetime.today(timeZone).toString(),
    companyId,
    userId
  };
}

const TECHNICIAN_FIELDS = ["findings", "resolution", "repairable"] as const;

/**
 * The technician's writes on the job page: a findings, resolution or
 * repairable field (`update`), and returning an issued part to stock
 * (`return-part`, the `serviceJobUnconsume` posting).
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {});
  const { jobId } = params;
  if (!jobId) {
    return data(
      {},
      await flash(request, error(null, "Service job is required"))
    );
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "return-part") {
    const serviceJobItemId = formData.get("serviceJobItemId");
    if (typeof serviceJobItemId !== "string" || !serviceJobItemId) {
      return data({}, await flash(request, error(null, "Part is required")));
    }
    const returned = await erpPosting(
      "issue",
      { companyId, userId },
      { type: "serviceJobUnconsume", serviceJobItemId }
    );
    if (returned.error) {
      return data(
        {},
        await flash(request, error(returned.error, returned.error.message))
      );
    }
    return data(
      {},
      await flash(request, success("Part returned to inventory"))
    );
  }

  if (intent === "update") {
    const field = formData.get("field");
    const value = formData.get("value");
    if (
      typeof field !== "string" ||
      !TECHNICIAN_FIELDS.includes(field as (typeof TECHNICIAN_FIELDS)[number])
    ) {
      return data({}, await flash(request, error(null, "Unknown field")));
    }
    const text = typeof value === "string" && value.trim() ? value : null;

    let values: ServiceJobTechnicianUpdate;
    if (field === "repairable") {
      if (text !== null && text !== "true" && text !== "false") {
        return data(
          {},
          await flash(request, error(null, "Repairable must be Yes or No"))
        );
      }
      values = { repairable: text === null ? null : text === "true" };
    } else {
      let document: Json = null;
      if (text) {
        try {
          document = JSON.parse(text) as Json;
        } catch {
          return data(
            {},
            await flash(request, error(null, "The notes are not valid"))
          );
        }
      }
      values =
        field === "findings"
          ? { findings: document }
          : { resolution: document };
    }

    const serviceRole = await getCarbonServiceRole();
    // The write is service-role: the job must be this company's, and open.
    const job = await serviceRole
      .from("serviceJob")
      .select("id, status")
      .eq("id", jobId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (!job.data) {
      return data(
        {},
        await flash(request, error(job.error, "Service job not found"))
      );
    }
    if (isServiceJobLocked(job.data.status)) {
      return data(
        {},
        await flash(request, error(null, `This job is ${job.data.status}`))
      );
    }

    const update = await updateServiceJobFields(serviceRole, {
      serviceJobId: jobId,
      companyId,
      updatedBy: userId,
      values
    });
    if (update.error) {
      log.error("Failed to update a service job", {
        companyId,
        jobId,
        field,
        error: update.error
      });
      return data(
        {},
        await flash(request, error(update.error, "Failed to save"))
      );
    }
    return data({ success: true });
  }

  return data({});
}

/** Saves one technician field through this route's `update` intent. */
function useUpdateField(jobId: string) {
  const fetcher = useAction({});
  return (field: (typeof TECHNICIAN_FIELDS)[number], value: string | null) => {
    const formData = new FormData();
    formData.append("intent", "update");
    formData.append("field", field);
    formData.append("value", value ?? "");
    fetcher.submit(formData, {
      method: "post",
      action: path.to.serviceJob(jobId)
    });
  };
}

function ServiceJobNotesSection({
  jobId,
  field,
  content: initialContent,
  isLocked
}: {
  jobId: string;
  field: "findings" | "resolution";
  content: JSONContent | null;
  isLocked: boolean;
}) {
  const onUpdate = useUpdateField(jobId);
  const onUploadImage = useImageUpload("service-job");
  const onUpdateContent = useDebounce(
    (next: JSONContent) => onUpdate(field, JSON.stringify(next)),
    2500,
    true
  );

  return (
    <WorkRecordSection
      title={
        field === "findings" ? (
          <Trans>Findings</Trans>
        ) : (
          <Trans>Resolution</Trans>
        )
      }
    >
      {isLocked ? (
        <RichTextView
          content={initialContent}
          empty={
            field === "findings" ? (
              <Trans>No findings</Trans>
            ) : (
              <Trans>No resolution</Trans>
            )
          }
        />
      ) : (
        <Editor
          initialValue={(initialContent ?? {}) as JSONContent}
          onUpload={onUploadImage}
          onChange={onUpdateContent}
          className="[&_.is-empty]:text-muted-foreground min-h-[120px] py-3 px-4 border rounded-md w-full"
        />
      )}
    </WorkRecordSection>
  );
}

function RepairableSection({
  jobId,
  repairable: initialRepairable,
  isLocked
}: {
  jobId: string;
  repairable: boolean | null;
  isLocked: boolean;
}) {
  const { t } = useLingui();
  const onUpdate = useUpdateField(jobId);
  const [repairable, setRepairable] = useState(initialRepairable);

  return (
    <WorkRecordSection title={<Trans>Repairable</Trans>}>
      <ToggleGroup
        type="single"
        aria-label={t`Repairable`}
        className="w-fit gap-0 rounded-full border border-border bg-muted p-1 shadow-sm"
        value={repairable === null ? "" : String(repairable)}
        disabled={isLocked}
        onValueChange={(value) => {
          // Clicking the selected answer again does not clear it.
          if (!value) return;
          setRepairable(value === "true");
          onUpdate("repairable", value);
        }}
      >
        {[
          {
            value: "true",
            label: t`Yes`,
            on: "data-[state=on]:bg-emerald-600 data-[state=on]:text-white hover:data-[state=on]:bg-emerald-600 hover:data-[state=on]:text-white"
          },
          {
            value: "false",
            label: t`No`,
            on: "data-[state=on]:bg-red-600 data-[state=on]:text-white hover:data-[state=on]:bg-red-600 hover:data-[state=on]:text-white"
          }
        ].map((option) => (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            className={cn(
              "rounded-full bg-transparent text-muted-foreground transition-all duration-200 hover:bg-active hover:text-active-foreground data-[state=on]:shadow-sm",
              "h-10 min-w-24 px-6 text-base",
              option.on
            )}
          >
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </WorkRecordSection>
  );
}

type JobFile = Awaited<ReturnType<typeof loader>>["files"][number];

function PhotosSection({
  jobId,
  companyId,
  files,
  isLocked
}: {
  jobId: string;
  companyId: string;
  files: JobFile[];
  isLocked: boolean;
}) {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const revalidator = useRevalidator();
  const [isUploading, setIsUploading] = useState(false);

  // Step.tsx's upload: the company's private bucket, under the job's folder,
  // which the ERP job page lists too.
  const onDrop = async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file || !carbon) return;
    setIsUploading(true);
    toast.info(t`Uploading ${file.name}`);
    const safeName = stripSpecialCharacters(file.name) || "photo";
    const upload = await storage(carbon)
      .company(company.id)
      .upload(
        `${company.id}/service-job/${jobId}/${nanoid(6)}-${safeName}`,
        file,
        { cacheControl: `${12 * 60 * 60}`, upsert: true }
      );
    setIsUploading(false);
    if (upload.error) {
      toast.error(t`Failed to upload file: ${file.name}`);
      return;
    }
    toast.success(t`Uploaded: ${file.name}`);
    revalidator.revalidate();
  };

  return (
    <WorkRecordSection
      title={<Trans>Photos</Trans>}
      description={<Trans>Photos of the unit, shared with the ERP job.</Trans>}
    >
      {files.length > 0 ? (
        <div className="grid grid-cols-3 gap-2 lg:grid-cols-4">
          {files.map((file) => {
            const filePath = `${companyId}/service-job/${jobId}/${file.name}`;
            return getDocumentType(file.name) === "Image" ? (
              <a
                key={file.id ?? file.name}
                href={getPrivateUrl(filePath)}
                target="_blank"
                rel="noreferrer"
                className="overflow-hidden rounded-lg border border-border"
              >
                <img
                  src={getPrivateUrl(filePath)}
                  alt={file.name}
                  className="aspect-square w-full object-cover"
                />
              </a>
            ) : (
              <a
                key={file.id ?? file.name}
                href={getPrivateUrl(filePath)}
                target="_blank"
                rel="noreferrer"
                className="flex aspect-square items-center justify-center rounded-lg border border-border p-2 text-xs text-muted-foreground break-all"
              >
                {file.name}
              </a>
            );
          })}
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">
          <Trans>No photos yet</Trans>
        </span>
      )}
      {!isLocked && !isUploading && <FileDropzone onDrop={onDrop} />}
    </WorkRecordSection>
  );
}

export default function ServiceJobRoute() {
  const {
    job,
    time,
    items,
    files,
    runningClock,
    laborCostRate,
    today,
    companyId,
    userId
  } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const { locale } = useLocale();
  const clockFetcher = useFetcher();
  const returnFetcher = useFetcher();
  const addPart = useDisclosure();
  const [tab, setTab] = useState("details");
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [allItems] = useItems();
  const workSites = useWorkSiteLabels();

  const itemOptions = useMemo(
    () =>
      allItems.map((item) => ({
        value: item.id,
        label: item.name,
        helper: item.readableIdWithRevision
      })),
    [allItems]
  );

  const isLocked = isServiceJobLocked(job.status);
  // Time cannot be logged without the cost rate, nor billed without the
  // job's bill rate.
  // The company's cost rate is a setting; a job's bill rate is on the job,
  // which the office sets in the ERP.
  const isMissingCostRate = !isLocked && laborCostRate === null;
  const isMissingBillRate =
    !isLocked &&
    !isMissingCostRate &&
    job.coverage === "Billable" &&
    job.laborBillRate === null;
  const isRunningHere = runningClock?.serviceJobId === job.id;
  const isRunningElsewhere = !!runningClock && !isRunningHere;
  const isBusy = clockFetcher.state !== "idle";

  const todayHours = time
    .filter((entry) => entry.employeeId === userId && entry.entryDate === today)
    .reduce((total, entry) => total + Number(entry.hours ?? 0), 0);
  const totalHours = time.reduce(
    (total, entry) => total + Number(entry.hours ?? 0),
    0
  );
  const quantity = (value: number) => formatQuantity(value, locale);

  const submitClock = (action: "Start" | "Stop" | "Complete") => {
    const formData = new FormData();
    formData.append("action", action);
    formData.append("serviceJobId", job.id);
    clockFetcher.submit(formData, {
      method: "post",
      action: path.to.serviceTime
    });
  };

  const unit = [job.item?.name, job.trackedEntity?.readableId]
    .filter(Boolean)
    .join(" · ");

  const properties = [
    {
      label: <Trans>Assignee</Trans>,
      value: job.assignee ? (
        <EmployeeAvatar employeeId={job.assignee} size="xs" />
      ) : (
        <span className="text-muted-foreground">
          <Trans>Unassigned</Trans>
        </span>
      )
    },
    {
      label: <Trans>Unit</Trans>,
      value: unit || (
        <span className="text-muted-foreground">
          <Trans>No unit</Trans>
        </span>
      )
    }
  ];

  const dock = isLocked ? (
    <WorkRecordDock
      properties={properties}
      actions={
        <div className="flex flex-col items-center gap-1 rounded-lg border bg-card p-3 text-center">
          <LuCheck className="size-6 text-emerald-500" />
          <ServiceJobStatus status={job.status} />
          <span className="text-xs text-muted-foreground">
            <Trans>Total time: {quantity(totalHours)} h</Trans>
          </span>
        </div>
      }
      compactActions={<ServiceJobStatus status={job.status} />}
    />
  ) : (
    <WorkRecordDock
      properties={properties}
      clock={
        isRunningHere ? (
          <PauseButton
            type="button"
            disabled={isBusy}
            onClick={() => submitClock("Stop")}
          />
        ) : (
          <PlayButton
            type="button"
            disabled={isBusy || isRunningElsewhere}
            onClick={() => submitClock("Start")}
          />
        )
      }
      caption={
        isRunningHere ? (
          <>
            <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 max-md:leading-tight">
              <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
              <span>
                <Trans>Running</Trans>
              </span>
            </span>
            {runningClock?.startTime && (
              <span className="text-sm text-muted-foreground">
                <Trans>
                  since{" "}
                  <DateTime value={runningClock.startTime} variant="time" />
                </Trans>
              </span>
            )}
          </>
        ) : isRunningElsewhere && runningClock ? (
          <span className="text-sm text-muted-foreground">
            <Trans>
              Running on{" "}
              <Link
                to={path.to.serviceJob(runningClock.serviceJobId)}
                className="underline"
              >
                {runningClock.serviceJob?.serviceJobId}
              </Link>
            </Trans>
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">
            <Trans>Start clock</Trans>
          </span>
        )
      }
      actions={
        <Button
          size="lg"
          variant="secondary"
          className="w-full"
          leftIcon={<FaCheck />}
          isDisabled={isBusy}
          onClick={() => setConfirmComplete(true)}
        >
          <Trans>Complete</Trans>
        </Button>
      }
      compactActions={
        <IconButtonWithTooltip
          icon={<FaCheck />}
          tooltip={t`Complete`}
          disabled={isBusy}
          onClick={() => setConfirmComplete(true)}
        />
      }
    />
  );

  return (
    <>
      <WorkRecordShell
        recordId={job.serviceJobId}
        back={{ to: path.to.service, label: <Trans>Service</Trans> }}
        tabs={[
          { value: "details", label: <Trans>Details</Trans> },
          { value: "notes", label: <Trans>Notes</Trans> },
          { value: "photos", label: <Trans>Photos</Trans> }
        ]}
        tab={tab}
        onTabChange={setTab}
        chips={
          <>
            <ServiceJobStatus status={job.status} />
            <WorkRecordChip icon={<LuSquareUser />}>
              {job.customer?.name}
            </WorkRecordChip>
            {job.trackedEntity && (
              <WorkRecordChip icon={<LuBarcode />}>
                {job.trackedEntity.readableId}
              </WorkRecordChip>
            )}
            <CoverageBadge coverage={job.coverage} />
            <WorkRecordChip icon={<LuMapPin />}>
              {workSites[job.workSite]}
            </WorkRecordChip>
            <WorkRecordChip
              icon={<ServicePriorityIcon priority={job.priority} />}
            >
              {job.priority}
            </WorkRecordChip>
            {job.dueDate && (
              <WorkRecordChip icon={<LuCalendarClock />}>
                <DateTime value={job.dueDate} variant="date" />
              </WorkRecordChip>
            )}
          </>
        }
        menu={
          <DropdownMenuItem asChild>
            <a
              href={path.to.serviceJobDetail(job.id)}
              target="_blank"
              rel="noreferrer"
            >
              <DropdownMenuIcon icon={<LuExternalLink />} />
              <Trans>Service Job Details</Trans>
            </a>
          </DropdownMenuItem>
        }
        dock={dock}
      >
        <WorkRecordPane value="details">
          {isMissingCostRate && (
            <Alert variant="warning">
              <LuTriangleAlert />
              <AlertTitle>
                <Trans>
                  Labor rates are not set. Time cannot be logged or billed until
                  they are.
                </Trans>
              </AlertTitle>
              <AlertDescription>
                <a
                  href={path.to.serviceSettings}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium hover:underline"
                >
                  <Trans>Set rates</Trans>
                </a>
              </AlertDescription>
            </Alert>
          )}
          {isMissingBillRate && (
            <Alert variant="warning">
              <LuTriangleAlert />
              <AlertTitle>
                <Trans>
                  This job has no bill rate. Ask the office to set it before the
                  time is billed.
                </Trans>
              </AlertTitle>
            </Alert>
          )}
          <WorkRecordTitle title={job.customer?.name} subtitle={unit} />
          <WorkRecordStats>
            <WorkRecordStat
              title={<Trans>Today</Trans>}
              icon={<LuTimer className="h-3 w-3 text-muted-foreground" />}
            >
              <Heading size="h1" className="font-sans">
                {t`${quantity(todayHours)} h`}
              </Heading>
            </WorkRecordStat>
            <WorkRecordStat
              title={<Trans>Total Time</Trans>}
              icon={<LuClock className="h-3 w-3 text-muted-foreground" />}
            >
              <Heading size="h1" className="font-sans">
                {t`${quantity(totalHours)} h`}
              </Heading>
            </WorkRecordStat>
            <WorkRecordStat
              title={<Trans>Warranty</Trans>}
              icon={<LuShieldCheck className="h-3 w-3 text-muted-foreground" />}
              className="max-xl:col-span-2"
            >
              {job.customerAsset ? (
                <VStack spacing={1} className="justify-start">
                  <WarrantyBadge asset={job.customerAsset} today={today} />
                  {job.customerAsset.laborWarrantyEndDate && (
                    <span className="text-muted-foreground text-sm">
                      <Trans>
                        Labor until{" "}
                        <DateTime
                          value={job.customerAsset.laborWarrantyEndDate}
                          variant="date"
                        />
                      </Trans>
                    </span>
                  )}
                </VStack>
              ) : (
                <span className="text-muted-foreground text-sm">
                  <Trans>No registered asset</Trans>
                </span>
              )}
            </WorkRecordStat>
          </WorkRecordStats>

          {!isRichTextEmpty(job.problem as JSONContent) && (
            <WorkRecordSection title={<Trans>Problem</Trans>}>
              <RichTextView content={job.problem as JSONContent} empty={null} />
            </WorkRecordSection>
          )}

          <RepairableSection
            jobId={job.id}
            repairable={job.repairable}
            isLocked={isLocked}
          />

          {(!isLocked || items.length > 0) && (
            <WorkRecordSection
              title={<Trans>Parts</Trans>}
              action={
                !isLocked && (
                  <Button
                    leftIcon={<LuCirclePlus />}
                    variant="secondary"
                    size="lg"
                    onClick={addPart.onOpen}
                  >
                    <Trans>Add Part</Trans>
                  </Button>
                )
              }
            >
              <WorkRecordTablePanel>
                <Table className="w-full text-base">
                  <Thead className="bg-muted/40">
                    <Tr>
                      <Th className="text-sm">
                        <Trans>Part</Trans>
                      </Th>
                      <Th className="text-sm">
                        <Trans>Quantity</Trans>
                      </Th>
                      <Th className="text-sm" />
                    </Tr>
                  </Thead>
                  <Tbody className="[&>tr:last-child]:border-0 [&>tr]:border-b">
                    {items.length > 0 ? (
                      items.map((line) => (
                        <Tr key={line.id} className="[&>td]:py-3">
                          <Td>
                            <VStack spacing={0}>
                              <span className="font-medium">
                                {line.item?.readableIdWithRevision}
                              </span>
                              <span className="text-muted-foreground text-sm">
                                {line.item?.name}
                                {line.lineType === "Charge"
                                  ? ` · ${t`Charge`}`
                                  : ""}
                              </span>
                            </VStack>
                          </Td>
                          <Td className="tabular-nums">
                            {quantity(Number(line.quantity))}{" "}
                            {line.unitOfMeasureCode}
                          </Td>
                          <Td className="text-right">
                            {!isLocked && line.lineType === "Part" && (
                              <IconButton
                                aria-label={t`Return part`}
                                size="lg"
                                variant="ghost"
                                icon={<LuX className="h-4 w-4" />}
                                isDisabled={returnFetcher.state !== "idle"}
                                onClick={() => {
                                  const formData = new FormData();
                                  formData.append("intent", "return-part");
                                  formData.append("serviceJobItemId", line.id);
                                  returnFetcher.submit(formData, {
                                    method: "post",
                                    action: path.to.serviceJob(job.id)
                                  });
                                }}
                              />
                            )}
                          </Td>
                        </Tr>
                      ))
                    ) : (
                      <Tr>
                        <Td
                          colSpan={3}
                          className="py-8 text-muted-foreground text-center"
                        >
                          <Trans>No parts added yet</Trans>
                        </Td>
                      </Tr>
                    )}
                  </Tbody>
                </Table>
              </WorkRecordTablePanel>
            </WorkRecordSection>
          )}

          {time.length > 0 && (
            <WorkRecordSection title={<Trans>Time Entries</Trans>}>
              <WorkRecordTablePanel>
                <Table className="w-full text-base">
                  <Thead className="bg-muted/40">
                    <Tr>
                      <Th className="text-sm">
                        <Trans>Employee</Trans>
                      </Th>
                      <Th className="text-sm">
                        <Trans>When</Trans>
                      </Th>
                      <Th className="text-sm text-right">
                        <Trans>Hours</Trans>
                      </Th>
                    </Tr>
                  </Thead>
                  <Tbody className="[&>tr:last-child]:border-0 [&>tr]:border-b">
                    {time.map((entry) => (
                      <Tr key={entry.id} className="[&>td]:py-3">
                        <Td>
                          <EmployeeAvatar
                            employeeId={entry.employeeId}
                            size="xs"
                          />
                        </Td>
                        <Td className="text-sm">
                          {entry.startTime ? (
                            <>
                              <DateTime
                                value={entry.startTime}
                                variant="absolute"
                              />
                              {entry.endTime && (
                                <>
                                  {" - "}
                                  <DateTime
                                    value={entry.endTime}
                                    variant="time"
                                  />
                                </>
                              )}
                            </>
                          ) : (
                            <DateTime value={entry.entryDate} variant="date" />
                          )}
                        </Td>
                        <Td className="text-right font-mono text-sm">
                          {entry.startTime && !entry.endTime
                            ? t`Running`
                            : t`${quantity(Number(entry.hours ?? 0))} h`}
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </WorkRecordTablePanel>
            </WorkRecordSection>
          )}
        </WorkRecordPane>

        <WorkRecordPane value="notes">
          <ServiceJobNotesSection
            jobId={job.id}
            field="findings"
            content={job.findings as JSONContent | null}
            isLocked={isLocked}
          />
          <ServiceJobNotesSection
            jobId={job.id}
            field="resolution"
            content={job.resolution as JSONContent | null}
            isLocked={isLocked}
          />
        </WorkRecordPane>

        <WorkRecordPane value="photos">
          <PhotosSection
            jobId={job.id}
            companyId={companyId}
            files={files}
            isLocked={isLocked}
          />
        </WorkRecordPane>
      </WorkRecordShell>

      {addPart.isOpen && (
        <ServiceJobAddPartModal
          serviceJobId={job.id}
          itemOptions={itemOptions}
          onClose={addPart.onClose}
        />
      )}
      {confirmComplete && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setConfirmComplete(false);
          }}
        >
          <ModalContent>
            <ModalHeader>
              <ModalTitle>{t`Complete ${job.serviceJobId}?`}</ModalTitle>
            </ModalHeader>
            <ModalBody>
              {isRunningHere ? (
                <Trans>
                  This stops your clock and posts the job's time. The job can no
                  longer change.
                </Trans>
              ) : (
                <Trans>
                  This posts the job's time. The job can no longer change.
                </Trans>
              )}
            </ModalBody>
            <ModalFooter>
              <Button
                size="lg"
                variant="secondary"
                onClick={() => setConfirmComplete(false)}
              >
                <Trans>Cancel</Trans>
              </Button>
              <Button
                size="lg"
                isLoading={isBusy}
                onClick={() => {
                  submitClock("Complete");
                  setConfirmComplete(false);
                }}
              >
                <Trans>Complete</Trans>
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </>
  );
}
