"use client";

import { createContext, useContext } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

import { FormCard } from "@/components/form";
import type { OcForm } from "@/types";

// The `question` tool, answered in place.
//
// opencode turns a `question` tool call into a form whose `metadata.tool.id` is
// the call's id, so the card can find its own form and reply to it. Rendering
// the form here — instead of the generic tool card — keeps the JSON arguments
// out of the transcript and puts the choices where the question was asked.

/** Where the inline `question` card finds its form and how to answer it. */
export const QuestionContext = createContext<{
  forms: OcForm[];
  onReply: (formId: string, answer: Record<string, unknown>) => Promise<void>;
}>({ forms: [], onReply: async () => {} });

/** Whether a form backs the `question` tool (and so renders inline). */
export function isQuestionForm(form: OcForm): boolean {
  return form.metadata?.kind === "question";
}

/** The pending form for a `question` tool call, by the call's id. */
export function questionFormFor(
  forms: OcForm[],
  toolCallId: string,
): OcForm | undefined {
  return forms.find(
    (form) =>
      isQuestionForm(form) && form.metadata?.tool?.id === toolCallId,
  );
}

/** The `question` tool's arguments. */
type QuestionArgs = {
  questions?: Array<{
    header?: string;
    question?: string;
    options?: Array<{ label?: string }>;
  }>;
};

export const QuestionTool: ToolCallMessagePartComponent = ({
  toolCallId,
  args,
}) => {
  const { forms, onReply } = useContext(QuestionContext);
  const form = questionFormFor(forms, toolCallId);

  if (form) {
    return (
      <div className="my-1">
        <FormCard form={form} onSubmit={(answer) => onReply(form.id, answer)} />
      </div>
    );
  }

  // No pending form: the question is already answered, or its form has not
  // arrived yet. Show what was asked so the transcript still reads.
  const questions = (args as QuestionArgs | undefined)?.questions ?? [];
  if (questions.length === 0) return null;

  return (
    <div className="my-1 flex flex-col gap-2 rounded-2xl border border-border bg-muted/30 p-3">
      {questions.map((question, index) => (
        <div key={index}>
          {question.header && (
            <div className="mb-0.5 text-xs text-muted-foreground">
              {question.header}
            </div>
          )}
          <div className="text-sm">{question.question}</div>
        </div>
      ))}
    </div>
  );
};
