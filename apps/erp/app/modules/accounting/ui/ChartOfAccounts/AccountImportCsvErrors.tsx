// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Alert, AlertDescription, AlertTitle } from "@carbon/react";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";
import type { AccountImportCsvError } from "../../account-import-csv";

/** Why an uploaded chart or default accounts file could not be read. */
export default function AccountImportCsvErrors({
  errors
}: {
  errors: AccountImportCsvError[];
}) {
  return (
    <Alert variant="destructive">
      <LuTriangleAlert />
      <AlertTitle>
        <Trans>The file could not be read</Trans>
      </AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-4">
          {errors.map((error, i) => (
            <li key={i}>
              <CsvErrorMessage error={error} />
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function CsvErrorMessage({ error }: { error: AccountImportCsvError }) {
  const { t } = useLingui();
  switch (error.code) {
    case "empty-file":
      return <Trans>The file has no rows.</Trans>;
    case "unreadable-file":
      return (
        <Trans>
          The file is not a valid CSV: a quoted value is never closed.
        </Trans>
      );
    case "too-large":
      return <Trans>The file is too large to be a chart of accounts.</Trans>;
    case "missing-columns": {
      const columns = error.columns.join(", ");
      return t`${plural(error.columns.length, {
        one: `The file has no ${columns} column.`,
        other: `The file has no ${columns} columns.`
      })}`;
    }
    case "missing-number":
      return <Trans>Line {error.line} has no account number.</Trans>;
    case "missing-name":
      return <Trans>Line {error.line} has no account name.</Trans>;
    case "missing-group":
      return <Trans>Line {error.line} has no group.</Trans>;
    case "missing-key":
      return <Trans>Line {error.line} has no key.</Trans>;
    case "invalid-class": {
      const value = error.value;
      return (
        <Trans>
          Line {error.line}: "{value}" is not a class. Use Asset, Liability,
          Equity, Revenue or Expense.
        </Trans>
      );
    }
  }
}
