import {
  Number as BaseNumber,
  NumberControlled as BaseNumberControlled
} from "@carbon/form";
import { withMinimumDecimals } from "@carbon/utils";
import type { ComponentProps } from "react";
import { useMemo } from "react";
import { useCurrencyMinDecimals } from "~/hooks/useCurrencies";

/**
 * Applies the company's `showCurrencyTrailingZeros` preference to a number
 * field's `formatOptions`, so an editable amount shows the same digits the
 * read-only ones beside it do. Any field whose options are not currency-styled
 * is passed straight through — quantities, rates and exchange rates have their
 * own kinds and are not part of this preference.
 *
 * Doing it here rather than at the ~80 `INPUT_FORMAT.money/price(...)` call
 * sites keeps the preference in one place, and is why those call sites still
 * pass two arguments.
 *
 * Safe despite `formatOptions` being part of the storage round-trip: react-aria
 * commits `parse(format(x))`, and only the MAXIMUM can change that. Padding
 * zeros carry no value, so overriding the MINIMUM cannot alter what is stored —
 * it changes what the field looks like, never what it saves.
 */
function useTrailingZeroPreference(
  formatOptions: Intl.NumberFormatOptions | undefined
) {
  const minDecimals = useCurrencyMinDecimals();

  // Memoized because react-stately keys its NumberFormatter off this object's
  // identity — returning a fresh one each render rebuilds the formatter on
  // every keystroke of every money field on the page.
  return useMemo(() => {
    if (minDecimals === undefined || formatOptions?.style !== "currency") {
      return formatOptions;
    }
    return withMinimumDecimals(formatOptions, minDecimals);
  }, [formatOptions, minDecimals]);
}

export function Number(props: ComponentProps<typeof BaseNumber>) {
  const formatOptions = useTrailingZeroPreference(props.formatOptions);
  return <BaseNumber {...props} formatOptions={formatOptions} />;
}

export function NumberControlled(
  props: ComponentProps<typeof BaseNumberControlled>
) {
  const formatOptions = useTrailingZeroPreference(props.formatOptions);
  return <BaseNumberControlled {...props} formatOptions={formatOptions} />;
}
