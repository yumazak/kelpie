import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OcForm, OcFormField, OcFormWhen } from "../types";

// opencode forms, rendered as inputs. Both the dock (blocking, multi-field
// prompts) and the inline `question` card (question.aui.tsx) share this, so a
// form always behaves the same wherever it is shown.

/** A form answer value, before it is coerced for the reply. */
export type FormValue = string | boolean | string[];

/** The current value of a field; an unchecked boolean reads as `false`. */
function valueOf(
  key: string,
  fields: OcFormField[],
  values: Record<string, FormValue>,
): unknown {
  const target = fields.find((field) => field.key === key);
  if (target?.type === "boolean") return values[key] === true;
  return values[key];
}

function matches(actual: unknown, expected: OcFormWhen["value"]): boolean {
  if (typeof expected === "number") return Number(actual) === expected;
  return actual === expected;
}

/** Whether a field is shown: not `hidden`, and every `when` condition met. */
export function isVisible(
  field: OcFormField,
  fields: OcFormField[],
  values: Record<string, FormValue>,
): boolean {
  if (field.hidden) return false;
  return (field.when ?? []).every((condition) => {
    const met = matches(valueOf(condition.key, fields, values), condition.value);
    return condition.op === "eq" ? met : !met;
  });
}

/** The fixed choices a field offers, when it offers any. */
function optionsOf(field: OcFormField) {
  return field.options ?? [];
}

const optionValue = (option: { value?: string; label?: string }): string =>
  option.value ?? option.label ?? "";

/** One field's control: a picker when it has options, an input otherwise. */
function FieldInput({
  field,
  value,
  onChange,
}: {
  field: OcFormField;
  value: FormValue;
  onChange: (next: FormValue) => void;
}) {
  if (field.type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
        {field.title ?? field.key}
      </label>
    );
  }

  const options = optionsOf(field);

  if (field.type === "multiselect") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-col gap-1.5">
        {options.map((option) => {
          const entry = optionValue(option);
          const checked = selected.includes(entry);
          return (
            <label key={entry} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={checked}
                onChange={() =>
                  onChange(
                    checked
                      ? selected.filter((item) => item !== entry)
                      : [...selected, entry],
                  )
                }
              />
              <span>
                <span className="block">{option.label ?? entry}</span>
                {option.description && (
                  <span className="block text-xs text-muted-foreground">
                    {option.description}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    );
  }

  // A single-choice field: the options are the answer, so make them tappable
  // rather than a text box the user must type into. `custom` still allows a
  // free-form answer below the choices.
  if (options.length > 0) {
    const selected = typeof value === "string" ? value : "";
    const isCustom = selected !== "" && !options.some((o) => optionValue(o) === selected);
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => {
            const entry = optionValue(option);
            const active = selected === entry;
            return (
              <button
                key={entry}
                type="button"
                onClick={() => onChange(entry)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-left text-sm transition-colors",
                  active
                    ? "border-foreground/40 bg-background text-foreground"
                    : "border-border text-muted-foreground hover:bg-background hover:text-foreground",
                )}
              >
                <span className="block">{option.label ?? entry}</span>
                {option.description && (
                  <span className="block text-xs text-muted-foreground">
                    {option.description}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {field.custom && (
          <input
            type="text"
            value={isCustom ? selected : ""}
            placeholder="その他（自由入力）"
            onChange={(event) => onChange(event.target.value)}
            className="w-full rounded-lg border border-border bg-background px-2 py-1 text-sm outline-none focus:border-foreground/30"
          />
        )}
      </div>
    );
  }

  return (
    <input
      type={field.type === "number" || field.type === "integer" ? "number" : "text"}
      value={typeof value === "string" ? value : ""}
      placeholder={field.placeholder ?? field.description}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-lg border border-border bg-background px-2 py-1 text-sm outline-none focus:border-foreground/30"
    />
  );
}

/** The visible fields' answers, coerced to the types the service expects. */
export function buildAnswer(
  fields: OcFormField[],
  values: Record<string, FormValue>,
): Record<string, unknown> {
  const answer: Record<string, unknown> = {};
  for (const field of fields) {
    if (!isVisible(field, fields, values)) continue;
    const value = values[field.key];
    if (value === undefined || value === "") continue;
    if (field.type === "number" || field.type === "integer") {
      const number = Number(value);
      if (!Number.isNaN(number)) answer[field.key] = number;
    } else {
      answer[field.key] = value;
    }
  }
  return answer;
}

/**
 * One form, ready to answer. Owns its field values; the caller decides what an
 * answer means (reply to the form, then refresh).
 */
export function FormCard({
  form,
  label = "回答",
  onSubmit,
}: {
  form: OcForm;
  label?: string;
  onSubmit: (answer: Record<string, unknown>) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<Record<string, FormValue>>({});

  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(buildAnswer(form.fields, values));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-3">
      {form.title && (
        <div className="mb-2 text-sm font-medium">{form.title}</div>
      )}
      <div className="flex flex-col gap-2">
        {form.fields
          .filter((field) => isVisible(field, form.fields, values))
          .map((field) => (
            <div key={field.key}>
              {field.type !== "boolean" && field.title && (
                <div className="mb-1 text-xs text-muted-foreground">
                  {field.title}
                </div>
              )}
              {field.type !== "boolean" &&
                field.description &&
                optionsOf(field).length === 0 && (
                  <div className="mb-1 text-xs text-muted-foreground">
                    {field.description}
                  </div>
                )}
              <FieldInput
                field={field}
                value={values[field.key] ?? ""}
                onChange={(next) =>
                  setValues((previous) => ({ ...previous, [field.key]: next }))
                }
              />
            </div>
          ))}
      </div>
      <Button
        size="sm"
        className="mt-3"
        disabled={busy}
        onClick={() => void submit()}
      >
        {label}
      </Button>
    </div>
  );
}
