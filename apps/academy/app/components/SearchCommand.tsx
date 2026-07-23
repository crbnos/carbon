import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Kbd
} from "@carbon/react";
import { useEffect, useState } from "react";
import { LuBookOpen, LuCirclePlay, LuSearch } from "react-icons/lu";
import { useNavigate } from "react-router";
import { modules } from "~/config";
import { path } from "~/utils/path";

type SearchEntry = {
  type: "course" | "lesson";
  label: string;
  sublabel: string;
  href: string;
  keywords: string;
};

// Static index built once from the course catalog — one entry per course + lesson.
const INDEX: SearchEntry[] = modules.flatMap((module) =>
  module.courses.flatMap((course) => {
    const courseEntry: SearchEntry = {
      type: "course",
      label: course.name,
      sublabel: module.name,
      href: path.to.course(module.id, course.id),
      keywords: course.description
    };
    const lessonEntries: SearchEntry[] = course.topics.flatMap((topic) =>
      topic.lessons.map((lesson) => ({
        type: "lesson",
        label: lesson.name,
        sublabel: `${course.name} · ${topic.name}`,
        href: path.to.lesson(lesson.id),
        keywords: `${module.name} ${topic.name} ${lesson.description}`
      }))
    );
    return [courseEntry, ...lessonEntries];
  })
);

const COURSES = INDEX.filter((e) => e.type === "course");
const LESSONS = INDEX.filter((e) => e.type === "lesson");

/** Global ⌘K command palette over courses + lessons. Renders its own trigger
 *  button (drop it in the header) and dialog; ⌘K / Ctrl+K toggles it. */
export function SearchCommand() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const onSelect = (href: string) => {
    setOpen(false);
    navigate(href);
  };

  const hasQuery = query.trim().length > 0;
  const renderItem = (entry: SearchEntry) => {
    const Icon = entry.type === "course" ? LuBookOpen : LuCirclePlay;
    return (
      <CommandItem
        key={entry.href}
        value={`${entry.label} ${entry.sublabel} ${entry.keywords}`}
        onSelect={() => onSelect(entry.href)}
        className="gap-3"
      >
        <Icon className="size-4 shrink-0 text-ed-ink/45" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{entry.label}</span>
          <span className="truncate text-[11px] text-muted-foreground">
            {entry.sublabel}
          </span>
        </div>
      </CommandItem>
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search courses and lessons"
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-ed-ink/10 bg-ed-warm-100 px-3 text-ed-14 font-book text-ink-faint shadow-[0_1px_2px_0_rgba(0,0,0,0.04)] transition-colors hover:bg-ed-hairline/60"
      >
        <LuSearch className="size-4" />
        <span className="hidden sm:inline">Search</span>
        <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search courses and lessons..."
          value={query}
          onValueChange={setQuery}
        />
        <CommandList className="max-h-[440px]">
          {hasQuery ? (
            <>
              <CommandEmpty className="py-6 text-center text-sm text-muted-foreground">
                No matches
              </CommandEmpty>
              <CommandGroup heading="Courses">
                {COURSES.map(renderItem)}
              </CommandGroup>
              <CommandGroup heading="Lessons">
                {LESSONS.map(renderItem)}
              </CommandGroup>
            </>
          ) : (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Type to search courses and lessons
            </div>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
