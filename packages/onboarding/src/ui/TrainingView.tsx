import { cn } from "@carbon/react";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Plural, useLingui } from "@lingui/react/macro";
import { LuArrowUpRight } from "react-icons/lu";
import { PAGE_COPY } from "../content";
import { TRAINING_TRACKS } from "../content/training";
import { fmtKey, isModuleExcluded } from "../logic";
import { EditableField } from "./EditableField";
import { PageHeader, Section, SectionList } from "./primitives";
import {
  useCheckMap,
  useExclusions,
  useFieldMap,
  useHubActions,
  useResolveVideoUrl
} from "./state";

type Format = "Self-paced" | "Hands-on";
const FORMATS: Format[] = ["Self-paced", "Hands-on"];

const FORMAT_LABEL: Record<Format, MessageDescriptor> = {
  "Self-paced": msg`Self-paced`,
  "Hands-on": msg`Hands-on`
};

export function TrainingView() {
  const { t, i18n } = useLingui();
  const exclusions = useExclusions();
  const map = useCheckMap();
  const fields = useFieldMap();
  const { setCheck } = useHubActions();
  const resolveVideoUrl = useResolveVideoUrl();

  const visibleTracks = TRAINING_TRACKS.filter(
    (track) => !isModuleExcluded(track.moduleTags, exclusions.modules)
  );

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      <PageHeader
        title={i18n._(PAGE_COPY.training.title)}
        lead={i18n._(PAGE_COPY.training.lead)}
      />

      {visibleTracks.map((track, i) => {
        const count = track.courses.length;
        return (
          <Section
            key={i}
            number={i + 1}
            title={i18n._(track.title)}
            subtitle={<Plural value={count} one="# course" other="# courses" />}
          >
            <SectionList>
              {track.courses.map((course) => {
                const key = fmtKey(course.key);
                const format = (map.get(key) as Format) ?? course.format;
                const videoUrl = course.videoKey
                  ? resolveVideoUrl(course.videoKey)
                  : undefined;
                return (
                  <li
                    key={course.key}
                    className="flex items-center gap-4 px-5 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      {videoUrl ? (
                        <a
                          href={videoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group inline-flex items-center gap-1 text-sm font-medium hover:text-primary transition-colors"
                        >
                          {i18n._(course.course)}
                          <LuArrowUpRight className="size-3.5 shrink-0 text-muted-foreground/50 transition group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                        </a>
                      ) : (
                        <div className="text-sm font-medium">
                          {i18n._(course.course)}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <span className="shrink-0">
                          {i18n._(course.audience)} ·
                        </span>
                        <EditableField
                          fieldKey={`training.${course.key}.length`}
                          value={fields.get(`training.${course.key}.length`)}
                          defaultValue={course.length}
                          placeholder={t`e.g. 2h`}
                          className="text-xs max-w-[90px]"
                        />
                      </div>
                    </div>
                    <div className="shrink-0 inline-flex items-center gap-0.5 rounded-full border bg-background p-0.5">
                      {FORMATS.map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setCheck(key, "fmt", f)}
                          aria-pressed={format === f}
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors active:scale-[0.96]",
                            format === f
                              ? "bg-card text-foreground shadow-button-base"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {i18n._(FORMAT_LABEL[f])}
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </SectionList>
          </Section>
        );
      })}
    </div>
  );
}
