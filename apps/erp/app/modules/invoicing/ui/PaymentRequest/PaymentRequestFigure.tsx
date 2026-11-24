// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export default function PaymentRequestFigure({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="tabular-nums font-medium">{value}</span>
    </div>
  );
}
