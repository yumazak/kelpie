// The skills attached to the next message.
//
// A skill is chosen in the composer (see `SkillPicker`) and rides along with
// the prompt as an opencode `Prompt.SkillAttachment` (`{ id }`). The state sits
// in the chat and is shared with the composer through this context, so both the
// picker and the send path read the same list.

import { createContext, useContext } from "react";

/** One skill attached to the next message. */
export interface AttachedSkill {
  id: string;
  /** The display name, from the picker (falls back to the id). */
  name: string;
}

export interface ComposerSkillsValue {
  /** The directory the conversation runs in; skills are scoped to it. */
  directory: string;
  /** The skills attached to the next message. */
  skills: AttachedSkill[];
  /** Add or remove a skill. */
  toggle: (skill: AttachedSkill) => void;
}

export const ComposerSkillsContext = createContext<ComposerSkillsValue | null>(
  null,
);

export function useComposerSkills(): ComposerSkillsValue {
  const value = useContext(ComposerSkillsContext);
  if (!value) {
    throw new Error("useComposerSkills must be used inside ComposerSkillsContext");
  }
  return value;
}
