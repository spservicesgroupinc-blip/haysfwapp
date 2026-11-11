import { useEffect, useId, useState } from "react";
import { Plus, Minus, Trash2 } from "lucide-react";
import "./SignedInputs.css";

type Sign = "+" | "-";

function SignButtons({
  sign,
  onChange,
  plusLabel,
  minusLabel,
  label,
}: {
  sign: Sign;
  onChange: (sign: Sign) => void;
  plusLabel: string;
  minusLabel: string;
  label: string;
}) {
  return (
    <div className="sign-buttons" role="group" aria-label={label}>
      <button
        type="button"
        className="sign-choice sign-add"
        aria-pressed={sign === "+"}
        onClick={() => onChange("+")}
      >
        <Plus size={18} aria-hidden="true" />
        <span>{plusLabel}</span>
      </button>
      <button
        type="button"
        className="sign-choice sign-remove"
        aria-pressed={sign === "-"}
        onClick={() => onChange("-")}
      >
        <Minus size={18} aria-hidden="true" />
        <span>{minusLabel}</span>
      </button>
    </div>
  );
}

export function SignedAmountInput({
  label,
  value,
  onChange,
  optional = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
  hint?: string;
}) {
  const id = useId();
  const [sign, setSign] = useState<Sign>(
    value.trim().startsWith("-") ? "-" : "+",
  );
  const amount = value.trim().replace(/^[+-]/, "");
  useEffect(() => {
    if (value.trim()) setSign(value.trim().startsWith("-") ? "-" : "+");
  }, [value]);
  const choose = (next: Sign) => {
    setSign(next);
    if (amount) onChange(`${next}${amount}`);
  };
  return (
    <div className="signed-amount">
      <label className="signed-label" htmlFor={id}>
        {label}
        {optional && <span className="signed-optional">Optional</span>}
      </label>
      <SignButtons
        sign={sign}
        onChange={choose}
        label={`${label} direction`}
        plusLabel="Increase"
        minusLabel="Credit"
      />
      <div
        className={`money-entry ${sign === "-" ? "is-credit" : "is-increase"}`}
      >
        <span className="money-prefix" aria-hidden="true">
          {sign === "-" ? "−" : "+"} $
        </span>
        <input
          id={id}
          aria-label={label}
          aria-describedby={`${id}-hint`}
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(event) => {
            const next = event.target.value.replace(/[,$\s]/g, "");
            if (/^\d*(?:\.\d{0,2})?$/.test(next))
              onChange(
                next
                  ? `${sign}${next.startsWith(".") ? `0${next}` : next}`
                  : "",
              );
          }}
          onBlur={() => {
            if (amount.endsWith(".")) onChange(`${sign}${amount.slice(0, -1)}`);
          }}
        />
        <span className="money-direction">
          {sign === "-" ? "Credit" : "Increase"}
        </span>
      </div>
      <small id={`${id}-hint`}>
        {hint ||
          (optional
            ? "Leave blank if the amount is unknown."
            : "Enter 0.00 when the price does not change.")}
      </small>
    </div>
  );
}

type Line = { sign: Sign; number: string };
const parseLines = (value: string): Line[] =>
  value.trim()
    ? value
        .trim()
        .split(/[\s,]+/)
        .map((entry) => ({
          sign: entry.startsWith("-") ? "-" : "+",
          number: entry.replace(/^[+-]/, ""),
        }))
    : [{ sign: "+", number: "" }];
const serializeLines = (rows: Line[]) =>
  rows
    .filter((row) => row.number)
    .map((row) => `${row.sign}${row.number}`)
    .join(", ");

export function LineChangesInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [rows, setRows] = useState<Line[]>(() => parseLines(value));
  useEffect(() => {
    if (serializeLines(rows) !== value) setRows(parseLines(value));
  }, [value]);
  const update = (next: Line[]) => {
    setRows(next);
    onChange(serializeLines(next));
  };
  const edit = (index: number, patch: Partial<Line>) =>
    update(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <div className="line-changes">
      <div className="signed-label">
        Estimate line changes<span className="signed-optional">Optional</span>
      </div>
      <p className="signed-help">
        Choose whether to add or remove each estimate line.
      </p>
      <div className="line-change-list">
        {rows.map((row, index) => (
          <div className="line-change-row" key={index}>
            <label className="estimate-line-number">
              <span>Line number</span>
              <input
                type="text"
                inputMode="numeric"
                aria-label={`Estimate line number ${index + 1}`}
                placeholder="e.g. 12"
                value={row.number}
                onChange={(event) => {
                  if (/^\d*$/.test(event.target.value))
                    edit(index, { number: event.target.value });
                }}
              />
            </label>
            <SignButtons
              sign={row.sign}
              onChange={(sign) => edit(index, { sign })}
              label={`Action for estimate line ${index + 1}`}
              plusLabel="Add"
              minusLabel="Remove"
            />
            <button
              type="button"
              className="delete-line"
              aria-label={`Delete estimate line ${index + 1}`}
              onClick={() =>
                update(
                  rows.length > 1
                    ? rows.filter((_, i) => i !== index)
                    : [{ sign: "+", number: "" }],
                )
              }
            >
              <Trash2 size={17} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="add-line"
        onClick={() => setRows([...rows, { sign: "+", number: "" }])}
      >
        <Plus size={16} aria-hidden="true" />
        Add another line
      </button>
    </div>
  );
}
