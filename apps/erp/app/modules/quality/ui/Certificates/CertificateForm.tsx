import { useCarbon } from "@carbon/auth";
import { storage } from "@carbon/files";
import { ValidatedForm } from "@carbon/form";
import { HStack, IconButton, toast, VStack } from "@carbon/react";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuFileText, LuX } from "react-icons/lu";
import { useFetcher } from "react-router";
import FileDropzone from "~/components/FileDropzone";
import {
  Hidden,
  Input,
  Select,
  Submit,
  Supplier,
  TextArea
} from "~/components/Form";
import { useUser } from "~/hooks";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";
import { certificateTypes, certificateValidator } from "../../quality.models";

type UploadedFile = { path: string; name: string; size: number };

type CertificateFormProps = {
  supplierId?: string | null;
  isDisabled?: boolean;
  onSaved?: () => void;
} & (
  | {
      // A supplier certificate on a received line.
      receiptLineId: string;
      jobOperation?: never;
    }
  | {
      // A special-process or functional-test certificate on a job operation
      // (FAI Form 2). The caller picks the operations and where to post.
      receiptLineId?: never;
      jobOperation: {
        options: { id: string; name: string }[];
        action: string;
        /** Storage folder under the company, e.g. `job/{jobId}`. */
        uploadFolder: string;
      };
    }
);

const CertificateForm = ({
  receiptLineId,
  jobOperation,
  supplierId,
  isDisabled = false,
  onSaved
}: CertificateFormProps) => {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const fetcher = useFetcher<{ success: boolean; message: string }>();
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  // Remounting the form after a save clears its fields.
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.success) {
      toast.success(t`Certificate added`);
      setFile(null);
      setFormKey((key) => key + 1);
      onSaved?.();
    } else {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.state, fetcher.data, onSaved, t]);

  const upload = async (files: File[]) => {
    const selected = files[0];
    if (!selected) return;
    if (!carbon) {
      toast.error(t`Carbon client not available`);
      return;
    }

    const folder = jobOperation
      ? jobOperation.uploadFolder
      : `inventory/${receiptLineId}`;
    const filePath = `${company.id}/${folder}/${
      stripSpecialCharacters(selected.name) || "file"
    }`;

    setIsUploading(true);
    const result = await storage(carbon)
      .company(company.id)
      .upload(filePath, selected, {
        cacheControl: `${12 * 60 * 60}`,
        upsert: true
      });
    setIsUploading(false);

    if (result.error || !result.data?.path) {
      toast.error(t`Failed to upload file: ${selected.name}`);
      setFile(null);
      return;
    }

    setFile({
      path: result.data.path,
      name: selected.name,
      size: Math.round(selected.size / 1024)
    });
  };

  const typeOptions = certificateTypes.map((type) => ({
    value: type,
    label: t(getCertificateTypeLabel(type))
  }));

  return (
    <ValidatedForm
      key={formKey}
      validator={certificateValidator}
      method="post"
      action={
        jobOperation
          ? jobOperation.action
          : path.to.receiptLineCertificates(receiptLineId ?? "")
      }
      defaultValues={{
        type: jobOperation ? "Special Process" : "Material",
        certificateNumber: "",
        specification: "",
        notes: "",
        supplierId: supplierId ?? undefined,
        receiptLineId,
        jobOperationId: jobOperation?.options[0]?.id
      }}
      fetcher={fetcher}
      className="w-full"
    >
      {receiptLineId && <Hidden name="receiptLineId" />}
      {file && (
        <>
          <Hidden name="path" value={file.path} />
          <Hidden name="name" value={file.name} />
          <Hidden name="size" value={file.size.toString()} />
        </>
      )}
      <VStack spacing={4}>
        {file ? (
          <HStack className="w-full justify-between rounded-md border px-3 py-2">
            <HStack spacing={2} className="min-w-0">
              <LuFileText className="shrink-0" />
              <span className="text-sm truncate">{file.name}</span>
            </HStack>
            <IconButton
              aria-label={t`Remove file`}
              variant="ghost"
              size="sm"
              icon={<LuX />}
              onClick={() => setFile(null)}
            />
          </HStack>
        ) : (
          <FileDropzone
            multiple={false}
            onDrop={upload}
            disabled={isDisabled || isUploading}
            className="w-full"
          />
        )}
        {jobOperation && (
          <Select
            name="jobOperationId"
            label={t`Operation`}
            options={jobOperation.options.map((operation) => ({
              value: operation.id,
              label: operation.name
            }))}
            isReadOnly={isDisabled}
          />
        )}
        <Select
          name="type"
          label={t`Type`}
          options={typeOptions}
          isReadOnly={isDisabled}
        />
        <Input
          name="certificateNumber"
          label={t`Certificate Number`}
          isDisabled={isDisabled}
        />
        <Input
          name="specification"
          label={t`Specification`}
          isDisabled={isDisabled}
        />
        <Supplier
          name="supplierId"
          label={t`Supplier`}
          isReadOnly={isDisabled}
        />
        <TextArea name="notes" label={t`Notes`} isDisabled={isDisabled} />
        <Submit
          hideShortcutKey
          isDisabled={isDisabled || isUploading}
          isLoading={fetcher.state !== "idle"}
        >
          <Trans>Add Certificate</Trans>
        </Submit>
      </VStack>
    </ValidatedForm>
  );
};

// Message descriptors, resolved by the caller's `t` from `useLingui()`. A
// helper that took `t` as an argument and used `` t`...` `` rendered blank:
// the macro only rewrites a `t` that comes from `useLingui()` in scope.
const CERTIFICATE_TYPE_LABELS: Record<
  (typeof certificateTypes)[number],
  MessageDescriptor
> = {
  Material: msg`Material`,
  "Special Process": msg`Special Process`,
  "Functional Test": msg`Functional Test`,
  Other: msg`Other`
};

export function getCertificateTypeLabel(
  type: (typeof certificateTypes)[number]
): MessageDescriptor {
  return CERTIFICATE_TYPE_LABELS[type] ?? { id: type, message: type };
}

export default CertificateForm;
