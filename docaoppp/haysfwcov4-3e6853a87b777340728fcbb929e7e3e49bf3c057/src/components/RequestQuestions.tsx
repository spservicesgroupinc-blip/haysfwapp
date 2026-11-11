import { Camera } from "lucide-react";
import { useId } from "react";
import type { ChangeRequest } from "../types";
import "./RequestQuestions.css";

type Answers = Pick<ChangeRequest, "requestType" | "customerCredits">;

export default function RequestQuestions({
  requestType,
  customerCredits,
  disabled = false,
  onChange,
}: Answers & {
  disabled?: boolean;
  onChange: (answers: Answers) => void;
}) {
  const groupName=useId();
  const answers = {
    requestType,
    customerCredits,
  };
  return (
    <fieldset className="request-questions" disabled={disabled}>
      <legend>Request details</legend>
      <div
        role="group"
        aria-label="Is this a change order or an insurance supplement?"
      >
        <p>Is this a change order or an insurance supplement?</p>
        {(
          [
            ["change_order", "Change order"],
            ["insurance_supplement", "Insurance supplement"],
          ] as const
        ).map(([value, label]) => (
          <label className="request-checkbox" key={value}>
            <input
              type="radio"
              name={groupName}
              checked={requestType === value}
              onChange={(event) =>
                onChange({
                  ...answers,
                  requestType: event.target.checked ? value : undefined,
                  customerCredits,
                })
              }
            />
            <span>{label}</span>
          </label>
        ))}
        <label className="request-checkbox"><input type="radio" name={groupName} checked={!requestType} onChange={()=>onChange({...answers,requestType:undefined})}/><span>Not specified</span></label>
        {requestType === "insurance_supplement" ? (
          <div className="insurance-supplement-reminder" role="status">
            <Camera size={18} />
            <span>
              Insurance supplements require photos. Please attach photos for insurance.
            </span>
          </div>
        ) : null}
      </div>
      <div role="group" aria-label="Does this include customer credits?">
        <p>Does this include customer credits?</p>
        <label className="request-checkbox">
          <input
            type="checkbox"
            checked={customerCredits === true}
            onChange={(event) =>
              onChange({ ...answers, customerCredits: event.target.checked })
            }
          />
          <span>Yes, customer credits</span>
        </label>
        <small>
          Leave unchecked if this does not include customer credits.
        </small>
      </div>
    </fieldset>
  );
}
