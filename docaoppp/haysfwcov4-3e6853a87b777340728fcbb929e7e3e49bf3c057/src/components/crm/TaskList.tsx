import { useState, type FormEvent } from "react";
import { Check, Plus } from "lucide-react";
import { today } from "../../types";
import type { NewTaskInput, Task } from "../../crm/types";
import "./crm.css";

export interface TaskListProps {
  tasks: Task[];
  onAddTask: (input: NewTaskInput) => Promise<void>;
  onToggle: (taskId: string) => Promise<void>;
}

export default function TaskList({ tasks, onAddTask, onToggle }: TaskListProps) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await onAddTask({
        title: title.trim(),
        dueDate: dueDate || undefined,
        assignee: assignee.trim() || undefined,
      });
      setTitle("");
      setDueDate("");
      setAssignee("");
    } finally {
      setBusy(false);
    }
  }

  const openTasks = tasks.filter((task) => task.status === "open");
  const todayStr = today();

  return (
    <section className="crm-section" aria-label="Tasks">
      <div className="crm-section-head">
        <h2>
          Tasks <span className="count">{openTasks.length}</span>
        </h2>
      </div>

      <form className="crm-task-form" onSubmit={handleAdd}>
        <div className="crm-field">
          <label htmlFor="crm-task-title">Task</label>
          <input
            id="crm-task-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Follow-up task"
          />
        </div>
        <div className="crm-field">
          <label htmlFor="crm-task-due">Due date</label>
          <input
            id="crm-task-due"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </div>
        <div className="crm-field">
          <label htmlFor="crm-task-assignee">Assignee</label>
          <input
            id="crm-task-assignee"
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
            placeholder="Who owns it?"
          />
        </div>
        <button
          type="submit"
          className="button primary"
          disabled={busy || !title.trim()}
        >
          <Plus size={16} />
          Add task
        </button>
      </form>

      {tasks.length ? (
        <ul className="crm-task-list">
          {[...tasks]
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .map((task) => {
              const overdue =
                task.status === "open" &&
                Boolean(task.dueDate) &&
                task.dueDate! < todayStr;
              return (
                <li
                  key={task.id}
                  className={`crm-task${task.status === "done" ? " is-done" : ""}${overdue ? " is-overdue" : ""}`}
                >
                  <input
                    type="checkbox"
                    className="crm-task-checkbox"
                    checked={task.status === "done"}
                    onChange={() => void onToggle(task.id)}
                    aria-label={`Mark "${task.title}" ${task.status === "done" ? "not done" : "done"}`}
                  />
                  <div className="crm-task-main">
                    <strong>{task.title}</strong>
                    <small>
                      {task.assignee ? `${task.assignee} · ` : ""}
                      {task.dueDate ? `Due ${task.dueDate}` : "No due date"}
                      {overdue ? " · Overdue" : ""}
                    </small>
                  </div>
                  {task.status === "done" ? (
                    <span className="crm-task-done">
                      <Check size={14} />
                      Done
                    </span>
                  ) : null}
                </li>
              );
            })}
        </ul>
      ) : (
        <p className="crm-empty">
          No tasks yet. Add a follow-up to stay on top of this customer.
        </p>
      )}
    </section>
  );
}
