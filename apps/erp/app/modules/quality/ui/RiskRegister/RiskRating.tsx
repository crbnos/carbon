// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export function RiskRating({
  rating,
  size = "default"
}: {
  rating: number;
  size?: "default" | "sm";
}) {
  const getColor = (rating: number) => {
    switch (rating) {
      case 5:
        return "bg-red-500";
      case 4:
        return "bg-orange-500";
      case 3:
        return "bg-yellow-500";
      case 2:
        return "bg-emerald-500";
      case 1:
      default:
        return "bg-emerald-500";
    }
  };

  const getBarSize = (size: "default" | "sm") => {
    switch (size) {
      case "sm":
        return "h-3 w-1";
      case "default":
      default:
        return "h-4 w-2";
    }
  };

  const bars = Array.from({ length: rating }, (_, index) => (
    <div key={index} className={`${getBarSize(size)} ${getColor(rating)}`} />
  ));
  return <div className="flex items-center gap-0.5">{bars}</div>;
}
