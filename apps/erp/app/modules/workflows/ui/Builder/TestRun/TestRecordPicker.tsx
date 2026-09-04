import { Combobox } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import type { loader } from "~/routes/x+/workflow+/$id.test-run";
import { path } from "~/utils/path";
import type { RecordPickerProps } from "../fields/recordPickers";
import { RECORD_PICKERS } from "../fields/recordPickers";

type TestRecordPickerProps = RecordPickerProps & {
  workflowId: string;
  entity: string;
};

/** The fallback picker for the ten entities with no store-backed selector. Loads a
 * page of recent records for the entity's table; the combobox filters it locally. */
export function TestRecordPicker({
  workflowId,
  entity,
  value,
  onChange,
  isDisabled
}: TestRecordPickerProps) {
  const { t } = useLingui();
  const fetcher = useFetcher<typeof loader>();
  const load = fetcher.load;

  useEffect(() => {
    load(`${path.to.workflowTestRun(workflowId)}?entity=${entity}`);
  }, [load, workflowId, entity]);

  const options =
    fetcher.data && "options" in fetcher.data ? fetcher.data.options : [];
  const isLoading = fetcher.state !== "idle";

  return (
    <Combobox
      options={options}
      value={value}
      isClearable
      isLoading={isLoading}
      isReadOnly={isDisabled}
      placeholder={t`Search records…`}
      emptyMessage={isLoading ? t`Loading…` : t`No records found`}
      onChange={(id) => onChange(id || undefined)}
    />
  );
}

/** The seven entities with a real selector keep it; the rest get the generic one. */
export function RecordPickerFor(props: TestRecordPickerProps) {
  const Existing = RECORD_PICKERS[props.entity];
  return Existing ? <Existing {...props} /> : <TestRecordPicker {...props} />;
}
