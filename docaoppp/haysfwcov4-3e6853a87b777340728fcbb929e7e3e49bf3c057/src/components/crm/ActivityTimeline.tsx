import { useState, type FormEvent } from "react";
import {
  CalendarClock,
  Mail,
  MessageSquare,
  MessageSquarePlus,
  PhoneCall,
  StickyNote,
  UserRound,
} from "lucide-react";
import type {
  Activity,
  ActivityKind,
  NewCommunicationInput,
} from "../../crm/types";
import "./crm.css";

export interface ActivityTimelineProps {
  activities: Activity[];
  onAddNote: (body: string) => Promise<void>;
  onLogCommunication: (input: NewCommunicationInput) => Promise<void>;
}

const KIND_LABEL: Record<ActivityKind, string> = {
  note: "Note",
  call: "Call",
  email: "Email",
  sms: "Text",
  meeting: "Meeting",
  other: "Other",
  status_change: "Status change",
  stage_change: "Stage change",
  request_submitted: "Request submitted",
  email_sent: "Email sent",
  task_completed: "Task completed",
};

function kindIcon(kind: ActivityKind) {
  switch (kind) {
    case "call":
      return <PhoneCall size={14} />;
    case "email":
    case "email_sent":
      return <Mail size={14} />;
    case "sms":
      return <MessageSquare size={14} />;
    case "meeting":
      return <CalendarClock size={14} />;
    case "note":
      return <StickyNote size={14} />;
    default:
      return <UserRound size={14} />;
  }
}

export default function ActivityTimeline({
  activities,
  onAddNote,
  onLogCommunication,
}: ActivityTimelineProps) {
  const [note, setNote] = useState("");
  const [logOpen, setLogOpen] = useState(false);
  const [kind, setKind] = useState<NewCommunicationInput["kind"]>("call");
  const [direction, setDirection] =
    useState<NewCommunicationInput["direction"]>("outbound");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!note.trim() || busy) return;
    setBusy(true);
    try {
      await onAddNote(note.trim());
      setNote("");
    } finally {
      setBusy(false);
    }
  }

  async function submitCommunication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!summary.trim() || busy) return;
    setBusy(true);
    try {
      await onLogCommunication({ kind, direction, summary: summary.trim() });
      setSummary("");
      setLogOpen(false);
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...activities].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section className="crm-section" aria-label="Activity">
      <div className="crm-section-head">
        <h2>Activity</h2>
        <button
          type="button"
          className="text-button"
          aria-expanded={logOpen}
          onClick={() => setLogOpen((open) => !open)}
        >
          <MessageSquarePlus size={15} />
          Log communication
        </button>
      </div>

      {logOpen ? (
        <form className="crm-log-form" onSubmit={submitCommunication}>
          <div className="crm-field">
            <label htmlFor="crm-comm-kind">Type</label>
            <select
              id="crm-comm-kind"
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as NewCommunicationInput["kind"])
              }
            >
              <option value="call">Call</option>
              <option value="email">Email</option>
              <option value="sms">Text</option>
              <option value="meeting">Meeting</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="crm-field">
            <label htmlFor="crm-comm-direction">Direction</label>
            <select
              id="crm-comm-direction"
              value={direction}
              onChange={(event) =>
                setDirection(
                  event.target.value as NewCommunicationInput["direction"],
                )
              }
            >
              <option value="outbound">Outbound</option>
              <option value="inbound">Inbound</option>
            </select>
          </div>
          <div className="crm-field crm-field-full">
            <label htmlFor="crm-comm-summary">Summary</label>
            <textarea
              id="crm-comm-summary"
              rows={2}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="What was discussed?"
            />
          </div>
          <div className="crm-form-actions crm-field-full">
            <button
              type="button"
              className="button"
              onClick={() => setLogOpen(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={busy || !summary.trim()}
            >
              Add to timeline
            </button>
          </div>
        </form>
      ) : null}

      <form className="crm-note-composer" onSubmit={submitNote}>
        <textarea
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Add a note…"
          aria-label="Add a note"
        />
        <button
          type="submit"
          className="button primary"
          disabled={busy || !note.trim()}
        >
          Add note
        </button>
      </form>

      {sorted.length ? (
        <ol className="crm-timeline">
          {sorted.map((activity) => (
            <li key={activity.id} className="crm-timeline-item">
              <span className="crm-timeline-dot" aria-hidden="true">
                {kindIcon(activity.kind)}
              </span>
              <div className="crm-timeline-body">
                <p>{activity.body}</p>
                <small>
                  {KIND_LABEL[activity.kind]}
                  {activity.direction === "inbound"
                    ? " · inbound"
                    : activity.direction === "outbound"
                      ? " · outbound"
                      : ""}
                  {" · "}
                  {new Date(activity.at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  {activity.by ? ` · ${activity.by}` : ""}
                </small>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="crm-empty">
          No activity yet. Add a note or log a call to get started.
        </p>
      )}
    </section>
  );
}
