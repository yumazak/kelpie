// The skill picker.
//
// opencode registers skills per project (`.opencode/skills`, `.claude/skills`,
// `.agents/skills`, global and project-local). `SkillPickerButton` opens a
// sheet of the ones the session's directory resolves to; `SkillChips` shows the
// attached ones above the composer. The selection itself lives in the chat
// (`composer-skills.tsx`) and becomes a prompt's `skills` array on send.

import { useMemo, useState, type FC } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, SearchIcon, SparklesIcon, XIcon } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useComposerSkills } from "../lib/composer-skills";
import { skillsQuery } from "../lib/queries";
import type { OcSkill } from "../types";
import { Dots } from "./loading-ui/dots";

/** The display name for a skill: its frontmatter name, else its id. */
function label(skill: OcSkill): string {
  return skill.name?.trim() || skill.id;
}

/** The picker button, in the composer's action row beside the attach button. */
export function SkillPickerButton() {
  const { directory, skills, toggle } = useComposerSkills();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const result = useQuery(skillsQuery(directory));

  const filtered = useMemo(() => {
    const skills = result.data ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return skills;
    return skills.filter((skill) =>
      [skill.id, skill.name, skill.description]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(needle)),
    );
  }, [result.data, query]);

  const attached = new Set(skills.map((skill) => skill.id));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <TooltipIconButton
            tooltip="スキル"
            side="bottom"
            variant="ghost"
            size="icon"
            className="aui-composer-add-skill text-muted-foreground hover:text-foreground hover:bg-muted-foreground/15 dark:border-muted-foreground/15 dark:hover:bg-muted-foreground/30 size-7 rounded-full active:scale-[0.96] motion-reduce:transition-none"
            aria-label="スキルを選択"
          />
        }
      >
        <SparklesIcon className="aui-composer-add-skill-icon size-4" />
      </DialogTrigger>

      {/* A bottom sheet: full width, anchored to the bottom, scrollable. */}
      <DialogContent className="fixed inset-x-0 bottom-0 left-0 top-auto z-50 flex max-h-[75dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-3 rounded-t-2xl rounded-b-none pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-none data-open:slide-in-from-bottom-4">
        <DialogTitle className="text-base font-medium">
          スキル
          {skills.length > 0 && (
            <span className="text-muted-foreground ml-2 text-xs">
              {skills.length} 件選択中
            </span>
          )}
        </DialogTitle>

        <label className="border-foreground/10 focus-within:border-foreground/25 flex items-center gap-2 rounded-xl border px-3 py-2">
          <SearchIcon className="text-muted-foreground size-4 shrink-0" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="スキルを検索…"
            className="placeholder:text-muted-foreground/60 w-full bg-transparent text-sm outline-none"
            aria-label="スキルを検索"
          />
        </label>

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {result.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Dots className="h-1.5 w-5" />
              読み込み中
            </div>
          ) : result.error ? (
            <div className="py-8 text-center text-sm text-destructive">
              {String(result.error)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {(result.data?.length ?? 0) === 0
                ? "このプロジェクトにスキルはありません"
                : "該当するスキルがありません"}
            </div>
          ) : (
            <div className="flex flex-col">
              {filtered.map((skill) => {
                const selected = attached.has(skill.id);
                return (
                  <button
                    key={skill.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggle({ id: skill.id, name: label(skill) })}
                    className="hover:bg-accent flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors"
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground",
                      )}
                      aria-hidden
                    >
                      {selected ? (
                        <CheckIcon className="size-3.5" />
                      ) : (
                        <SparklesIcon className="size-3.5" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {label(skill)}
                      </span>
                      {skill.description && (
                        <span className="text-muted-foreground line-clamp-2 block text-xs">
                          {skill.description}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The attached skills, above the composer input. */
export const SkillChips: FC = () => {
  const { skills, toggle } = useComposerSkills();
  if (skills.length === 0) return null;

  return (
    <div className="aui-composer-skills flex w-full flex-row flex-wrap items-center gap-1.5 empty:hidden">
      {skills.map((skill) => (
        <span
          key={skill.id}
          className="bg-muted text-foreground inline-flex max-w-full items-center gap-1 rounded-full py-1 ps-2 pe-1 text-xs"
        >
          <SparklesIcon className="text-muted-foreground size-3 shrink-0" />
          <span className="truncate">{skill.name}</span>
          <button
            type="button"
            onClick={() => toggle(skill)}
            aria-label={`${skill.name} を外す`}
            className="text-muted-foreground hover:bg-foreground/10 hover:text-foreground rounded-full p-0.5"
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
};
