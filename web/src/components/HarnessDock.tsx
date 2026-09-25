import { replyForm } from "../api";
import type { OcForm } from "../types";
import { FormCard } from "./form";

// opencode's blocking prompts that are *not* the `question` tool. A question is
// rendered inline in the conversation (see question.aui.tsx); everything else —
// a typed, multi-field form — docks above the composer.

export function HarnessDock({
  sessionId,
  forms,
  onReplied,
}: {
  sessionId: string;
  forms: OcForm[];
  onReplied: () => Promise<void>;
}) {
  if (forms.length === 0) return null;

  return (
    <div className="mx-2 mb-2 flex flex-col gap-2">
      {forms.map((form) => (
        <FormCard
          key={form.id}
          form={form}
          onSubmit={async (answer) => {
            await replyForm(sessionId, form.id, answer);
            await onReplied();
          }}
        />
      ))}
    </div>
  );
}
