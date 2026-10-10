// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  ColorPicker,
  cn,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@carbon/react";
import { GeneratedAvatarPreview } from "@carbon/react/GeneratedAvatar";
import type { GeneratedAvatarStyle } from "@carbon/utils";
import {
  DEFAULT_GENERATED_AVATAR_STYLE,
  formatGeneratedAvatar,
  GENERATED_AVATAR_STYLES,
  isGeneratedAvatarStyle,
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
  const [selectedSeed, setSelectedSeed] = useState<string | null>(
    currentParsed?.seed ?? null
  );

  const valueOf = (seed: string) =>
    formatGeneratedAvatar({ style, seed, background });
  const selected = selectedSeed ? valueOf(selectedSeed) : null;

  const changeStyle = (value: string) => {
    if (!isGeneratedAvatarStyle(value) || value === style) return;
    setStyle(value);
    setSeeds(seedsFor(value));
    setSelectedSeed(currentParsed?.style === value ? currentParsed.seed : null);
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
            <Trans>Pick a style and an avatar, or shuffle for new ones.</Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <Select value={style} onValueChange={changeStyle}>
            <SelectTrigger aria-label={t`Avatar style`} className="mb-4">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GENERATED_AVATAR_STYLES.map((option) => (
                <SelectItem key={option} value={option}>
                  {STYLE_INFO[option].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="mb-4 flex items-center gap-2">
            <span className="shrink-0 text-sm text-muted-foreground">
              <Trans>Background</Trans>
            </span>
            <ColorPicker
              value={background ? `#${background}` : ""}
              onChange={(value) => {
                const color = normalizeAvatarBackground(value);
                if (color) setBackground(color);
              }}
              placeholder={t`Style default`}
            />
            {background && (
              <Button variant="ghost" onClick={() => setBackground(null)}>
                <Trans>Reset</Trans>
              </Button>
            )}
          </div>
          <div className="grid grid-cols-4 gap-3 justify-items-center">
            {seeds.map((seed, index) => {
              const isSelected = seed === selectedSeed;
              return (
                <button
                  key={seed}
                  type="button"
                  aria-label={t`Avatar option ${index + 1}`}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedSeed(seed)}
                  className={cn(
                    "rounded-full p-1 ring-2 ring-transparent transition-[box-shadow,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-ring",
                    isSelected ? "ring-primary" : "hover:ring-border"
                  )}
                >
                  {/* Drawn in the browser: a color drag makes a new value per
                      step, too fast to fetch each one from the server. */}
                  <GeneratedAvatarPreview size="lg" value={valueOf(seed)} />
                </button>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-muted-foreground text-pretty">
            <Trans>
              Avatars from{" "}
              <a
                className="underline"
                href={info.source.url}
                target="_blank"
                rel="noreferrer"
              >
                {info.source.name}
              </a>{" "}
              by {info.creator}, licensed under{" "}
              <a
                className="underline"
                href={info.license.url}
                target="_blank"
                rel="noreferrer"
              >
                {info.license.name}
              </a>
              .
            </Trans>
          </p>
        </ModalBody>
        <ModalFooter>
          <HStack className="w-full justify-between">
            <Button
              variant="secondary"
              leftIcon={<LuShuffle />}
              onClick={shuffle}
            >
              <Trans>Shuffle</Trans>
            </Button>
            <HStack>
              <Button variant="ghost" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                isDisabled={!selected || selected === currentGenerated}
                onClick={() => {
                  if (selected) onSave(selected);
                }}
              >
                <Trans>Save</Trans>
              </Button>
            </HStack>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default GeneratedAvatarPicker;
