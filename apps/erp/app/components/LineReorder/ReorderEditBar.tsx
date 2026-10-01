// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button } from "@carbon/react";
import { Trans } from "@lingui/react/macro";

type ReorderEditBarProps = {
  isSaving: boolean;
  isDirty: boolean;
  onSave: () => void;
  onCancel: () => void;
};

export function ReorderEditBar({
  isSaving,
  isDirty,
  onSave,
  onCancel
}: ReorderEditBarProps) {
  return (
    <div className="flex gap-1 flex-1">
      <Button
        size="sm"
        variant="ghost"
        onClick={onCancel}
        isDisabled={isSaving}
        className="flex-1 h-8 text-xs"
      >
        <Trans>Cancel</Trans>
      </Button>
      <Button
        size="sm"
        variant="primary"
        onClick={onSave}
        isDisabled={!isDirty || isSaving}
        className="flex-1 h-8 text-xs"
      >
        {isSaving ? <Trans>Saving...</Trans> : <Trans>Save</Trans>}
      </Button>
    </div>
  );
}
