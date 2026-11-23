// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import { Button, toast } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCheck } from "react-icons/lu";
import { path } from "~/utils/path";

export function ResolveMaterialRequestButton({
  materialRequestId
}: {
  materialRequestId: string;
}) {
  const { t } = useLingui();
  const fetcher = useAction<{ success: boolean; message?: string }>({
    onError: (data) => toast.error(data.message ?? t`Failed to resolve request`)
  });
  const isSubmitting = fetcher.isPending;

  return (
    <fetcher.Form
      method="post"
      action={path.to.lineFeedResolve(materialRequestId)}
      className="w-full"
    >
      <Button
        type="submit"
        variant="secondary"
        size="lg"
        leftIcon={<LuCheck />}
        isLoading={isSubmitting}
        isDisabled={isSubmitting}
        className="w-full"
      >
        <Trans>Resolve</Trans>
      </Button>
    </fetcher.Form>
  );
}
