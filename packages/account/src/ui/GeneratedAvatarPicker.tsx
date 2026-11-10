// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  cn,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { GeneratedAvatarPreview } from "@carbon/react/GeneratedAvatar";
import type { GeneratedAvatarStyle } from "@carbon/utils";
import {
  DEFAULT_GENERATED_AVATAR_STYLE,
  formatGeneratedAvatar,
  GENERATED_AVATAR_STYLES,
  newGeneratedAvatarSeed,
  normalizeAvatarBackground,
  parseGeneratedAvatar
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuShuffle } from "react-icons/lu";

const OPTION_COUNT = 12;

const CC0 = {
  name: "CC0 1.0",
  url: "https://creativecommons.org/publicdomain/zero/1.0/"
};

// Proper names, so not translated. Credit comes from each style's DiceBear
// `meta`; Croodles (CC BY 4.0) requires it, the CC0 styles get it as courtesy.
const STYLE_INFO: Record<
  GeneratedAvatarStyle,
  {
    label: string;
    source: { name: string; url: string };
    creator: string;
    license: { name: string; url: string };
  }
> = {
  "croodles-neutral": {
    label: "Croodles Neutral",
    source: {
      name: "Croodles",
      url: "https://www.figma.com/community/file/966199982810283152"
    },
    creator: "vijay verma",
    license: {
      name: "CC BY 4.0",
      url: "https://creativecommons.org/licenses/by/4.0/"
    }
  },
  notionists: {
    label: "Notionists",
    source: {
      name: "Notionists",
      url: "https://heyzoish.gumroad.com/l/notionists"
    },
    creator: "Zoish",
    license: CC0
  },
  "notionists-neutral": {
    label: "Notionists Neutral",
    source: {
      name: "Notionists",
      url: "https://heyzoish.gumroad.com/l/notionists"
    },
    creator: "Zoish",
    license: CC0
  },
  lorelei: {
    label: "Lorelei",
    source: {
      name: "Lorelei",
      url: "https://www.figma.com/community/file/1198749693280469639"
    },
    creator: "Lisa Wischofsky",
    license: CC0
  },
  "lorelei-neutral": {
    label: "Lorelei Neutral",
    source: {
      name: "Lorelei Neutral",
      url: "https://www.figma.com/community/file/1198749693280469639"
    },
    creator: "Lisa Wischofsky",
    license: CC0
  },
  loops: {
    label: "Loops",
    source: { name: "Loops", url: "https://www.dicebear.com" },
    creator: "DiceBear",
    license: CC0
  },
  "pixel-art": {
    label: "Pixel Art",
    source: {
      name: "Pixel Art",
      url: "https://www.figma.com/community/file/1198754108850888330"
    },
    creator: "DiceBear",
    license: CC0
  },
  "voxel-art": {
    label: "Voxel Art",
    source: { name: "Voxel Art", url: "https://www.dicebear.com" },
    creator: "DiceBear",
    license: CC0
  },
  "voxel-bot": {
    label: "Voxel Bot",
    source: { name: "Voxel Bot", url: "https://www.dicebear.com" },
    creator: "DiceBear",
    license: CC0
  },
  planets: {
    label: "Planets",
    source: { name: "Planets", url: "https://www.dicebear.com" },
    creator: "DiceBear",
    license: CC0
  }
};

// Soft tints that suit every style, then one dark tone (the line-art styles
// switch to white ink on it). Lowercase hex without `#`, as stored.
const BACKGROUNDS = [
  "fee2e2",
  "ffedd5",
  "fef3c7",
  "dcfce7",
  "cffafe",
  "dbeafe",
  "ede9fe",
  "27272a"
];

type GeneratedAvatarPickerProps = {
  current: string | null;
  onClose: () => void;
  onSave: (value: string) => void;
};

function randomSeeds(count: number) {
  return Array.from({ length: count }, () => newGeneratedAvatarSeed());
}

const GeneratedAvatarPicker = ({
  current,
  onClose,
  onSave
}: GeneratedAvatarPickerProps) => {
  const { t } = useLingui();
  const currentParsed = parseGeneratedAvatar(current);
  const currentGenerated = currentParsed ? current : null;

  const [style, setStyle] = useState<GeneratedAvatarStyle>(
    currentParsed?.style ?? DEFAULT_GENERATED_AVATAR_STYLE
  );
  // `null` = each style's own background.
  const [background, setBackground] = useState<string | null>(
    currentParsed?.background ?? null
  );

  // The grid holds seeds; style and background apply to all of them, so a new
  // color repaints the whole grid. In the current avatar's style its seed
  // stays first, so neither shuffling nor switching styles loses it.
  const seedsFor = (forStyle: GeneratedAvatarStyle) =>
    currentParsed && currentParsed.style === forStyle
      ? [currentParsed.seed, ...randomSeeds(OPTION_COUNT - 1)]
      : randomSeeds(OPTION_COUNT);

  const [seeds, setSeeds] = useState<string[]>(() => seedsFor(style));
  // Something is always chosen, so the preview never sits empty: the current
  // avatar's face, else the first in the grid.
  const [selectedSeed, setSelectedSeed] = useState<string>(
    () => currentParsed?.seed ?? seeds[0] ?? newGeneratedAvatarSeed()
  );

  const valueOf = (seed: string, forStyle = style) =>
    formatGeneratedAvatar({ style: forStyle, seed, background });
  const selected = valueOf(selectedSeed);

  // A face is a seed, and a seed draws a different face in every style, so
  // switching style keeps the seed and the preview changes in place.
  const changeStyle = (value: GeneratedAvatarStyle) => {
    if (value === style) return;
    setStyle(value);
    const next = seedsFor(value);
    // Keep the chosen face, without displacing the current avatar's seed,
    // which `seedsFor` pins first in the current avatar's own style.
    if (!next.includes(selectedSeed)) {
      next.splice(currentParsed?.style === value ? 1 : 0, 1, selectedSeed);
    }
    setSeeds(next);
  };

  const shuffle = () => {
    setSeeds((previous) => {
      const keep = previous.filter(
        (seed) => seed === currentParsed?.seed || seed === selectedSeed
      );
      return [...keep, ...randomSeeds(OPTION_COUNT - keep.length)];
    });
  };

  const info = STYLE_INFO[style];
  const isCustomBackground =
    background !== null && !BACKGROUNDS.includes(background);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Choose avatar</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>Pick a style, a color and a face.</Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody className="flex flex-col gap-5">
          <div className="flex items-center gap-5">
            {/* Drawn in the browser: a color drag makes a new value per step,
                too fast to fetch each one from the server. */}
            <GeneratedAvatarPreview size="xl" value={selected} />
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{info.label}</span>
                <span className="text-xs text-muted-foreground text-pretty">
                  <Trans>
                    By{" "}
                    <a
                      className="underline decoration-border underline-offset-2 hover:decoration-foreground"
                      href={info.source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {info.creator}
                    </a>
                    ,{" "}
                    <a
                      className="underline decoration-border underline-offset-2 hover:decoration-foreground"
                      href={info.license.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {info.license.name}
                    </a>
                  </Trans>
                </span>
              </div>
              <div
                role="radiogroup"
                aria-label={t`Background`}
                className="flex flex-wrap items-center gap-1.5"
              >
                <Swatch
                  label={t`Style default`}
                  isSelected={background === null}
                  onSelect={() => setBackground(null)}
                  className="bg-[linear-gradient(135deg,transparent_45%,var(--color-border)_45%,var(--color-border)_55%,transparent_55%)] bg-background"
                />
                {BACKGROUNDS.map((color) => (
                  <Swatch
                    key={color}
                    label={`#${color}`}
                    isSelected={background === color}
                    onSelect={() => setBackground(color)}
                    style={{ backgroundColor: `#${color}` }}
                  />
                ))}
                <label
                  className={cn(
                    "relative size-6 cursor-pointer rounded-full ring-1 ring-inset ring-black/10 transition-[box-shadow,transform] duration-150 ease-out active:scale-[0.92] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                    isCustomBackground
                      ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                      : "bg-[conic-gradient(#f87171,#fbbf24,#4ade80,#22d3ee,#818cf8,#f472b6,#f87171)]"
                  )}
                  style={
                    isCustomBackground
                      ? { backgroundColor: `#${background}` }
                      : undefined
                  }
                >
                  <span className="sr-only">
                    <Trans>Custom color</Trans>
                  </span>
                  <input
                    type="color"
                    className="sr-only"
                    value={`#${background ?? "ffffff"}`}
                    onChange={(e) => {
                      const color = normalizeAvatarBackground(e.target.value);
                      if (color) setBackground(color);
                    }}
                  />
                </label>
              </div>
            </div>
          </div>

          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              <Trans>Style</Trans>
            </h3>
            <div
              role="radiogroup"
              aria-label={t`Avatar style`}
              className="grid grid-cols-5 gap-1.5"
            >
              {GENERATED_AVATAR_STYLES.map((option) => {
                const isSelected = option === style;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => changeStyle(option)}
                    className={cn(
                      "flex min-w-0 flex-col items-center gap-1.5 rounded-lg px-1 pt-2 pb-1.5 text-[0.6875rem] leading-tight transition-[background-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isSelected
                        ? "bg-muted text-foreground shadow-[inset_0_0_0_1px_var(--color-border)]"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    <GeneratedAvatarPreview
                      size="md"
                      value={valueOf(selectedSeed, option)}
                    />
                    <span className="line-clamp-2 min-h-[2lh] w-full text-balance text-center">
                      {STYLE_INFO[option].label}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium text-muted-foreground">
                <Trans>Face</Trans>
              </h3>
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<LuShuffle />}
                onClick={shuffle}
              >
                <Trans>Shuffle</Trans>
              </Button>
            </div>
            <div
              role="radiogroup"
              aria-label={t`Face`}
              className="grid grid-cols-6 justify-items-center gap-2"
            >
              {seeds.map((seed, index) => {
                const isSelected = seed === selectedSeed;
                return (
                  <button
                    key={seed}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    aria-label={t`Face ${index + 1}`}
                    onClick={() => setSelectedSeed(seed)}
                    className={cn(
                      "rounded-full ring-offset-2 ring-offset-background transition-[box-shadow,transform] duration-150 ease-out active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isSelected
                        ? "ring-2 ring-primary"
                        : "ring-0 ring-transparent hover:ring-2 hover:ring-border"
                    )}
                  >
                    <GeneratedAvatarPreview size="lg" value={valueOf(seed)} />
                  </button>
                );
              })}
            </div>
          </section>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            isDisabled={selected === currentGenerated}
            onClick={() => onSave(selected)}
          >
            <Trans>Save</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

function Swatch({
  label,
  isSelected,
  onSelect,
  className,
  style
}: {
  label: string;
  isSelected: boolean;
  onSelect: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isSelected}
      aria-label={label}
      title={label}
      onClick={onSelect}
      style={style}
      className={cn(
        "size-6 rounded-full ring-1 ring-inset ring-black/10 transition-[box-shadow,transform] duration-150 ease-out active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isSelected &&
          "ring-2 ring-primary ring-offset-2 ring-offset-background",
        className
      )}
    />
  );
}

export default GeneratedAvatarPicker;
