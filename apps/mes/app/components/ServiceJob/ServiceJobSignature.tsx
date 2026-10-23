// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import type { SignaturePadHandle } from "@carbon/react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  SignaturePad,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { LuSignature } from "react-icons/lu";
import { getPrivateUrl, path } from "~/utils/path";

/**
 * The customer signs for the work on the technician's device. The PNG and the
 * signer's name are saved on the job (`service.$jobId.signature`) and carried
 * into its completion. A locked job shows the saved signature only.
 */
export function ServiceJobSignature({
  serviceJobId,
  signaturePath,
  signedByName,
  isDisabled
}: {
  serviceJobId: string;
  signaturePath: string | null;
  signedByName: string | null;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const padRef = useRef<SignaturePadHandle>(null);
  const [hasInk, setHasInk] = useState(false);
  const [name, setName] = useState("");
  const [isSigning, setIsSigning] = useState(false);
  const fetcher = useAction<{ error?: { message: string } | null }>({
    onSuccess: () => {
      setIsSigning(false);
      setHasInk(false);
    },
    onError: (data) =>
      toast.error(data?.error?.message ?? t`Failed to save the signature`)
  });
  const isSaving = fetcher.state !== "idle";

  const save = async () => {
    const pad = padRef.current;
    if (!pad || pad.isEmpty() || !name.trim()) return;
    let blob: Blob;
    try {
      blob = await pad.toBlob();
    } catch {
      toast.error(t`Failed to read the signature`);
      return;
    }
    const formData = new FormData();
    formData.append(
      "signature",
      new File([blob], "signature.png", { type: "image/png" })
    );
    formData.append("signedByName", name.trim());
    fetcher.submit(formData, {
      method: "post",
      action: path.to.serviceJobSignature(serviceJobId),
      encType: "multipart/form-data"
    });
  };

  const showSaved = signaturePath && !isSigning;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <Trans>Signature</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {showSaved ? (
          <>
            <div className="overflow-hidden rounded-lg border border-border bg-white">
              <img
                src={getPrivateUrl(signaturePath)}
                alt={t`Signature`}
                className="h-40 w-full object-contain"
              />
            </div>
            <span className="text-sm">
              <Trans>Signed by {signedByName}</Trans>
            </span>
            {!isDisabled && (
              <Button
                size="lg"
                variant="secondary"
                leftIcon={<LuSignature />}
                className="self-start"
                onClick={() => setIsSigning(true)}
              >
                <Trans>Sign Again</Trans>
              </Button>
            )}
          </>
        ) : isDisabled ? (
          <p className="text-sm text-muted-foreground">
            <Trans>Not signed.</Trans>
          </p>
        ) : (
          <>
            <SignaturePad
              ref={padRef}
              strokeColor="#000000"
              className="[&>div:first-child]:bg-white"
              onChange={(isEmpty) => setHasInk(!isEmpty)}
              disabled={isSaving}
            />
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-muted-foreground">
                <Trans>Signed by</Trans>
              </span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                className="h-11"
              />
            </label>
            <Button
              size="lg"
              variant="primary"
              leftIcon={<LuSignature />}
              isDisabled={!hasInk || !name.trim()}
              isLoading={isSaving}
              onClick={save}
            >
              <Trans>Save Signature</Trans>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
