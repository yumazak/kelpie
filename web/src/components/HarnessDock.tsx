import { useState } from "react";

import { Button } from "@/components/ui/button";
import { replyForm, replyPermission } from "../api";
import type { OcForm, OcFormField, OcFormWhen, OcPermission } from "../types";

// opencode's own blocking prompts, answered from the phone: a permission
// request becomes allow / always / reject, and a form becomes its fields.

/** A form answer value, before it is coerced for the reply. */
type FormValue = string | boolean | string[];

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
function isVisible(
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

function FormField({
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

  if (field.type === "multiselect") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-col gap-1">
        {(field.options ?? []).map((option) => {
          const optionValue = option.value ?? option.label ?? "";
          const checked = selected.includes(optionValue);
          return (
            <label key={optionValue} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  onChange(
                    checked
                      ? selected.filter((entry) => entry !== optionValue)
                      : [...selected, optionValue],
                  )
                }
              />
              {option.label ?? optionValue}
            </label>
          );
        })}
      </div>
    );
  }

  return (
    <input
      type={
        field.type === "number" || field.type === "integer" ? "number" : "text"
      }
      value={typeof value === "string" ? value : ""}
      placeholder={field.description}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-lg border border-border bg-background px-2 py-1 text-sm outline-none focus:border-foreground/30"
    />
  );
}

function buildAnswer(
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

export function HarnessDock({
  sessionId,
  permissions,
  forms,
  onReplied,
}: {
  sessionId: string;
  permissions: OcPermission[];
  forms: OcForm[];
  onReplied: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<Record<string, FormValue>>({});

  if (permissions.length === 0 && forms.length === 0) return null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      await onReplied();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-2 mb-2 flex flex-col gap-2">
      {permissions.map((permission) => (
        <div
          key={permission.id}
          className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3"
        >
          <div className="mb-2 flex items-center gap-2 text-sm">
            <span aria-hidden>⛔</span>
            <span className="font-medium">
              {permission.action ?? "permission"}
            </span>
          </div>
          {(permission.message || (permission.resources?.length ?? 0) > 0) && (
            <pre className="mb-3 max-h-32 overflow-auto rounded-lg bg-background/60 p-2 font-mono text-xs break-words whitespace-pre-wrap">
              {[permission.message, ...(permission.resources ?? [])]
                .filter(Boolean)
                .join("\n")}
            </pre>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(() => replyPermission(sessionId, permission.id, "once"))
              }
            >
              許可
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  replyPermission(sessionId, permission.id, "always"),
                )
              }
            >
              常に許可
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  replyPermission(sessionId, permission.id, "reject"),
                )
              }
            >
              拒否
            </Button>
          </div>
        </div>
      ))}

      {forms.map((form) => (
        <div
          key={form.id}
          className="rounded-2xl border border-border bg-muted/40 p-3"
        >
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
                  <FormField
                    field={field}
                    value={values[field.key] ?? ""}
                    onChange={(next) =>
                      setValues((previous) => ({
                        ...previous,
                        [field.key]: next,
                      }))
                    }
                  />
                </div>
              ))}
          </div>
          <Button
            size="sm"
            className="mt-3"
            disabled={busy}
            onClick={() =>
              void run(() =>
                replyForm(sessionId, form.id, buildAnswer(form.fields, values)),
              )
            }
          >
            回答
          </Button>
        </div>
      ))}
    </div>
  );
}
