import React, { useEffect, useRef } from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";
import "./ConfirmDeleteModal.css";

export interface ConfirmDeleteModalProps {
  isOpen: boolean;
  title?: string;
  message?: string;
  itemSummary?: {
    customer?: string;
    jobNumber?: string;
    orderNumber?: string;
    status?: string;
  };
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDeleteModal({
  isOpen,
  title = "Delete change order request?",
  message = "Are you sure you want to delete this request? This action will permanently remove the request and all attachments. It cannot be undone.",
  itemSummary,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDeleteModalProps) {
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    cancelBtnRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, busy, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="confirm-delete-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className="confirm-delete-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        aria-describedby="confirm-delete-desc"
      >
        <button
          type="button"
          className="confirm-delete-close"
          onClick={onCancel}
          disabled={busy}
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>

        <div className="confirm-delete-header">
          <div className="confirm-delete-icon" aria-hidden="true">
            <AlertTriangle size={24} />
          </div>
          <div>
            <h2 id="confirm-delete-title" className="confirm-delete-title">
              {title}
            </h2>
            <p id="confirm-delete-desc" className="confirm-delete-message">
              {message}
            </p>
          </div>
        </div>

        {itemSummary ? (
          <div className="confirm-delete-preview">
            {itemSummary.customer ? (
              <div className="confirm-delete-preview-row">
                <span className="confirm-delete-label">Customer</span>
                <strong className="confirm-delete-value">
                  {itemSummary.customer}
                </strong>
              </div>
            ) : null}
            {itemSummary.jobNumber ? (
              <div className="confirm-delete-preview-row">
                <span className="confirm-delete-label">Job Number</span>
                <span className="confirm-delete-value">
                  {itemSummary.jobNumber}
                </span>
              </div>
            ) : null}
            {itemSummary.orderNumber ? (
              <div className="confirm-delete-preview-row">
                <span className="confirm-delete-label">Order #</span>
                <span className="confirm-delete-value">
                  {itemSummary.orderNumber}
                </span>
              </div>
            ) : null}
            {itemSummary.status ? (
              <div className="confirm-delete-preview-row">
                <span className="confirm-delete-label">Status</span>
                <span className="confirm-delete-value">
                  {itemSummary.status}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="confirm-delete-actions">
          <button
            type="button"
            ref={cancelBtnRef}
            className="button"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button danger-solid"
            onClick={onConfirm}
            disabled={busy}
          >
            <Trash2 size={16} />
            {busy ? "Deleting…" : "Yes, delete request"}
          </button>
        </div>
      </div>
    </div>
  );
}
