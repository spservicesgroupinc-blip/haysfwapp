import { useEffect, useRef } from "react";
import type { ChangeRequest } from "../types";
import {
  documentFieldValue,
  type DocumentField,
} from "../services/customerDocumentFields";
import { SignedAmountInput } from "./SignedInputs";

export default function DocumentFieldInput({
  field,
  draft,
  onChange,
  autoFocus = false,
}: {
  field: DocumentField;
  draft: ChangeRequest;
  onChange: (value: string | boolean) => void;
  autoFocus?: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoFocus)
      element.current
        ?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
          "input,textarea",
        )
        ?.focus();
  }, [autoFocus, field.key]);
  const value = documentFieldValue(draft, field.key);
  return (
    <div ref={element}>
      {field.kind === "amount" ? (
        <SignedAmountInput
          label={field.label}
          value={String(value)}
          onChange={onChange}
        />
      ) : (
        <label className="field">
          <span>{field.label}</span>
          {field.kind === "multiline" ? (
            <textarea
              aria-label={field.label}
              rows={6}
              value={String(value)}
              onChange={(event) => onChange(event.target.value)}
            />
          ) : field.kind === "boolean" ? (
            <select
              aria-label={field.label}
              value={value ? "yes" : "no"}
              onChange={(event) => onChange(event.target.value === "yes")}
            >
              <option value="yes">Insurance related</option>
              <option value="no">Non-insurance related</option>
            </select>
          ) : (
            <input
              aria-label={field.label}
              type={field.kind === "date" ? "date" : "text"}
              inputMode={
                field.kind === "money"
                  ? "decimal"
                  : field.kind === "days"
                    ? "numeric"
                    : undefined
              }
              value={String(value)}
              onChange={(event) => onChange(event.target.value)}
            />
          )}
        </label>
      )}
    </div>
  );
}
