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
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Heading,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  RadioGroup,
  RadioGroupButton,
  RichTextView,
  SidebarTrigger,
  toast,
  useDebounce,
  useDisclosure,
  useViewport,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import {
  canComplete,
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
import { FaPause, FaPlay } from "react-icons/fa6";
import { LuArrowLeft, LuCheck, LuCirclePlus, LuX } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Link, useFetcher, useLoaderData } from "react-router";
import { DateTime } from "~/components";
import EmployeeAvatar from "~/components/EmployeeAvatar";
import FileDropzone from "~/components/FileDropzone";
import { MesAppBar } from "~/components/MesAppBar";
import {
  CoverageBadge,
  ServiceJobAddPartModal,
  ServiceJobSignature,
  ServiceJobStatus,
  useWorkSiteLabels,
  WarrantyBadge
} from "~/components/ServiceJob";
import { useImageUpload, useUser } from "~/hooks";
import { erpPosting } from "~/services/erp";
import {
  getRunningServiceClock,
  getServiceJob,
  getServiceJobFiles,
  getServiceJobItems,
  getServiceJobTime,
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

  const [job, time, items, files, runningClock, timeZone] = await Promise.all([
    getServiceJob(client, companyId, jobId),
    getServiceJobTime(client, companyId, jobId),
    getServiceJobItems(client, companyId, jobId),
    getServiceJobFiles(client, companyId, jobId),
    getRunningServiceClock(client, { employeeId: userId, companyId }),
    getCompanyTimeZone(client, companyId)
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
    // The signature is shown on its own card, not with the photos.
    files: (files.data ?? []).filter((file) => file.name !== "signature.png"),
    runningClock: runningClock.data,
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

function ServiceJobNotesCard({
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
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          {field === "findings" ? (
            <Trans>Findings</Trans>
          ) : (
            <Trans>Resolution</Trans>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}

function RepairableCard({
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
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <Trans>Repairable</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <RadioGroup
          aria-label={t`Repairable`}
          className="flex gap-2"
          value={repairable === null ? "" : String(repairable)}
          disabled={isLocked}
          onValueChange={(value) => {
            setRepairable(value === "true");
            onUpdate("repairable", value);
          }}
        >
          {[
            { value: "true", label: t`Yes` },
            { value: "false", label: t`No` }
          ].map((option) => (
            <RadioGroupButton
              key={option.value}
              value={option.value}
              className="h-11 min-w-24 data-[state=checked]:bg-accent data-[state=checked]:text-foreground data-[state=checked]:border-primary"
            >
              {option.label}
            </RadioGroupButton>
          ))}
        </RadioGroup>
      </CardContent>
    </Card>
  );
}

type JobFile = Awaited<ReturnType<typeof loader>>["files"][number];

function PhotosCard({
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
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <Trans>Photos</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {files.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
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
          <span className="text-xs text-muted-foreground">
            <Trans>No photos yet</Trans>
          </span>
        )}
        {!isLocked && !isUploading && <FileDropzone onDrop={onDrop} />}
      </CardContent>
    </Card>
  );
}

export default function ServiceJobRoute() {
  const { job, time, items, files, runningClock, today, companyId, userId } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const { locale } = useLocale();
  const { isPhone } = useViewport();
  const clockFetcher = useFetcher();
  const returnFetcher = useFetcher();
  const addPart = useDisclosure();
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
  const isRunningHere = runningClock?.serviceJobId === job.id;
  const isRunningElsewhere = !!runningClock && !isRunningHere;
  const isBusy = clockFetcher.state !== "idle";
  const completable = canComplete(job);

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

  return (
    <div className="flex flex-col flex-1">
      <MesAppBar
        title={job.serviceJobId}
        subtitle={<Trans>Service</Trans>}
        back={{ to: path.to.service }}
      />
      {!isPhone && (
        <header className="sticky top-0 z-10 flex h-[var(--header-height)] shrink-0 items-center gap-2 border-b bg-card max-md:hidden">
          <div className="flex items-center gap-2 px-2 w-full justify-between">
            <HStack>
              <SidebarTrigger />
              <Link to={path.to.service}>
                <Button variant="ghost" size="sm" aria-label={t`Back`}>
                  <LuArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <Heading size="h4">{job.serviceJobId}</Heading>
              <ServiceJobStatus status={job.status} />
            </HStack>
          </div>
        </header>
      )}

      <main className="flex-1 min-h-0 w-full overflow-y-auto scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent p-4">
        <VStack spacing={4} className="max-w-2xl mx-auto">
          <div className="flex w-full items-center md:hidden">
            <ServiceJobStatus status={job.status} />
          </div>

          {/* Customer and unit */}
          <Card className="w-full">
            <CardHeader className="max-md:hidden">
              <CardTitle className="text-sm text-muted-foreground font-normal">
                <Trans>Customer</Trans>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <VStack spacing={2} className="items-start">
                <span className="hidden text-xs text-muted-foreground max-md:block">
                  <Trans>Customer</Trans>
                </span>
                <span className="text-lg font-semibold">
                  {job.customer?.name}
                </span>
                {unit && (
                  <span className="text-sm text-muted-foreground">{unit}</span>
                )}
                <HStack spacing={2} className="flex-wrap">
                  <CoverageBadge coverage={job.coverage} />
                  <Badge variant="outline">{workSites[job.workSite]}</Badge>
                  {job.customerAsset && (
                    <WarrantyBadge asset={job.customerAsset} today={today} />
                  )}
                </HStack>
              </VStack>
            </CardContent>
          </Card>

          {/* Problem */}
          {job.problem && (
            <Card className="w-full">
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground font-normal">
                  <Trans>Problem</Trans>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{job.problem}</p>
              </CardContent>
            </Card>
          )}

          {/* Clock */}
          {!isLocked && (
            <Card className="w-full">
              <CardHeader className="max-md:hidden">
                <CardTitle>
                  <span className="text-sm text-muted-foreground">
                    <Trans>Today: {quantity(todayHours)} h</Trans>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 max-md:pt-4">
                <p className="mb-3 text-xs text-muted-foreground md:hidden">
                  <Trans>Today: {quantity(todayHours)} h</Trans>
                </p>
                <VStack spacing={4} className="items-center">
                  <button
                    type="button"
                    aria-label={isRunningHere ? t`Stop` : t`Start`}
                    disabled={isBusy || isRunningElsewhere}
                    onClick={() =>
                      submitClock(isRunningHere ? "Stop" : "Start")
                    }
                    className={cn(
                      "group size-24 flex flex-row items-center gap-2 justify-center rounded-full shadow-lg hover:cursor-pointer hover:drop-shadow-xl hover:scale-105 transition-all text-white text-3xl border-b-4 active:border-b-0 active:translate-y-1 motion-reduce:transition-none motion-reduce:hover:scale-100 disabled:bg-gray-500 disabled:hover:bg-gray-600 disabled:border-gray-700 disabled:cursor-not-allowed",
                      isRunningHere
                        ? "bg-red-500 hover:bg-red-600 border-red-700"
                        : "bg-emerald-500 hover:bg-emerald-600 border-emerald-700"
                    )}
                  >
                    {isRunningHere ? (
                      <FaPause className="group-hover:scale-110" />
                    ) : (
                      <FaPlay className="group-hover:scale-110" />
                    )}
                  </button>
                  {isRunningHere && runningClock?.startTime && (
                    <span className="text-sm text-muted-foreground">
                      <Trans>
                        Running since{" "}
                        <DateTime
                          value={runningClock.startTime}
                          variant="time"
                        />
                      </Trans>
                    </span>
                  )}
                  {isRunningElsewhere && runningClock && (
                    <span className="text-sm text-muted-foreground text-center">
                      <Trans>
                        Your clock is running on{" "}
                        <Link
                          to={path.to.serviceJob(runningClock.serviceJobId)}
                          className="underline"
                        >
                          {runningClock.serviceJob?.serviceJobId}
                        </Link>
                        . Stop it there first.
                      </Trans>
                    </span>
                  )}
                </VStack>
              </CardContent>
            </Card>
          )}

          {/* Time entries */}
          {time.length > 0 && (
            <Card className="w-full">
              <CardHeader>
                <CardTitle>
                  <Trans>Time Entries</Trans>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="w-full divide-y">
                  {time.map((entry) => (
                    <div
                      key={entry.id}
                      className="py-2 flex justify-between items-center gap-2"
                    >
                      <VStack spacing={2} className="items-start min-w-0">
                        <EmployeeAvatar
                          employeeId={entry.employeeId}
                          size="xs"
                        />
                        <span className="text-xs text-muted-foreground">
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
                          {entry.laborItem?.name
                            ? ` · ${entry.laborItem.name}`
                            : ""}
                        </span>
                      </VStack>
                      <span className="text-sm font-mono shrink-0">
                        {entry.startTime && !entry.endTime
                          ? t`Running`
                          : t`${quantity(Number(entry.hours ?? 0))} h`}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Parts */}
          {(!isLocked || items.length > 0) && (
            <Card className="w-full">
              <CardHeader>
                <HStack className="justify-between w-full">
                  <CardTitle className="text-sm font-medium">
                    <Trans>Parts</Trans>
                  </CardTitle>
                  {!isLocked && (
                    <Button
                      variant="secondary"
                      leftIcon={<LuCirclePlus />}
                      className="max-md:h-11"
                      onClick={addPart.onOpen}
                    >
                      <Trans>Add</Trans>
                    </Button>
                  )}
                </HStack>
              </CardHeader>
              <CardContent>
                {items.length > 0 ? (
                  <div className="w-full divide-y">
                    {items.map((line) => (
                      <div
                        key={line.id}
                        className="py-2 flex justify-between items-center gap-2"
                      >
                        <VStack spacing={0} className="items-start min-w-0">
                          <span className="text-sm truncate w-full">
                            {line.item?.name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {quantity(Number(line.quantity))}{" "}
                            {line.unitOfMeasureCode}
                            {line.lineType === "Charge"
                              ? ` · ${t`Charge`}`
                              : ""}
                          </span>
                        </VStack>
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
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    <Trans>No parts added yet</Trans>
                  </span>
                )}
              </CardContent>
            </Card>
          )}

          <ServiceJobNotesCard
            jobId={job.id}
            field="findings"
            content={job.findings as JSONContent | null}
            isLocked={isLocked}
          />
          <ServiceJobNotesCard
            jobId={job.id}
            field="resolution"
            content={job.resolution as JSONContent | null}
            isLocked={isLocked}
          />
          <RepairableCard
            jobId={job.id}
            repairable={job.repairable}
            isLocked={isLocked}
          />
          <PhotosCard
            jobId={job.id}
            companyId={companyId}
            files={files}
            isLocked={isLocked}
          />
          <ServiceJobSignature
            serviceJobId={job.id}
            signaturePath={job.signaturePath}
            signedByName={job.signedByName}
            isDisabled={isLocked}
          />

          {/* Complete */}
          {isLocked ? (
            <Card className="w-full bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800">
              <CardContent className="pt-6">
                <VStack spacing={2}>
                  <LuCheck className="h-8 w-8 text-emerald-600" />
                  <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    <ServiceJobStatus status={job.status} />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    <Trans>Total time: {quantity(totalHours)} h</Trans>
                  </span>
                </VStack>
              </CardContent>
            </Card>
          ) : (
            <VStack spacing={2} className="w-full">
              <Button
                size="lg"
                variant="primary"
                leftIcon={<LuCheck />}
                isDisabled={isBusy || !completable}
                onClick={() => setConfirmComplete(true)}
                className="w-full h-12"
              >
                <Trans>Complete</Trans>
              </Button>
              {!completable && (
                <span className="text-xs text-muted-foreground">
                  <Trans>
                    This job needs an accepted estimate before it can be
                    completed.
                  </Trans>
                </span>
              )}
            </VStack>
          )}
        </VStack>
      </main>

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
    </div>
  );
}
