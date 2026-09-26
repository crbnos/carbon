import { useCarbon } from "@carbon/auth";
import { storage } from "@carbon/files";
import { ValidatedForm } from "@carbon/form";
import { HStack, IconButton, toast, VStack } from "@carbon/react";
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
  receiptLineId: string;
  supplierId?: string | null;
  isDisabled?: boolean;
  onSaved?: () => void;
};

const CertificateForm = ({
  receiptLineId,
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

    const filePath = `${company.id}/inventory/${receiptLineId}/${
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
    label: getCertificateTypeLabel(type, t)
  }));

  return (
    <ValidatedForm
      key={formKey}
      validator={certificateValidator}
      method="post"
      action={path.to.receiptLineCertificates(receiptLineId)}
      defaultValues={{
        type: "Material",
        certificateNumber: "",
        specification: "",
        notes: "",
        supplierId: supplierId ?? undefined,
        receiptLineId
      }}
      fetcher={fetcher}
      className="w-full"
    >
      <Hidden name="receiptLineId" />
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

export function getCertificateTypeLabel(
  type: (typeof certificateTypes)[number],
  t: ReturnType<typeof useLingui>["t"]
) {
  switch (type) {
    case "Material":
      return t`Material`;
    case "Special Process":
      return t`Special Process`;
    case "Functional Test":
      return t`Functional Test`;
    case "Other":
      return t`Other`;
    default:
      return type;
  }
}

export default CertificateForm;
