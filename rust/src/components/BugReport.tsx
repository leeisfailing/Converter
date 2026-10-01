import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { copyText } from "../lib/clipboard";
import Select from "./Select";
import { useState, useRef, useEffect } from "react";
import { X, Bug, Download, CheckCircle, AlertCircle } from "lucide-react";

interface Props {
  onClose: () => void;
}

interface BugReport {
  title: string;
  email: string;
  description: string;
  stepsToReproduce: string;
  expectedBehavior: string;
  actualBehavior: string;
  errorMessages: string;
  severity: "low" | "medium" | "high" | "critical";
  category: "bug" | "error" | "crash" | "performance" | "other";
}

export default function BugReport({ onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [report, setReport] = useState<BugReport>({
    title: "",
    email: "",
    description: "",
    stepsToReproduce: "",
    expectedBehavior: "",
    actualBehavior: "",
    errorMessages: "",
    severity: "medium",
    category: "bug",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current!;
    const trigger = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement) trigger.focus();
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setReport((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      const path = await save({
        title: "Save bug report",
        defaultPath: "converter-bug-report.txt",
        filters: [{ name: "Text report", extensions: ["txt"] }],
      });
      if (!path) return;
      await writeFile(path, new TextEncoder().encode(formatReport()));
      setSaved(true);
    } catch (err) {
      setError("Failed to save bug report. Please try again.");
      console.error("Bug report save error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const formatReport = () => `
BUG REPORT
==========
Title: ${report.title}
Email: ${report.email || "Not provided"}
Category: ${report.category}
Severity: ${report.severity}

Description:
${report.description}

Steps to Reproduce:
${report.stepsToReproduce}

Expected Behavior:
${report.expectedBehavior}

Actual Behavior:
${report.actualBehavior}

Error Messages:
${report.errorMessages}
    `.trim();

  const handleCopyToClipboard = async () => {
    const ok = await copyText(formatReport());
    setCopied(ok);
    setError(ok ? null : "Could not copy the report. Your saved text file is still available.");
  };

  if (saved) {
    return (
      <dialog
        ref={dialogRef}
        aria-labelledby="bug-report-title"
        className="about-dialog w-[calc(100%_-_2rem)] max-w-lg max-h-[85vh] overflow-y-auto p-5"
        onKeyDown={(event) => event.stopPropagation()}
        onCancel={(event) => { event.preventDefault(); onClose(); }}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.target === event.currentTarget &&
            (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) onClose();
        }}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <CheckCircle size={20} className="text-green-500" />
            <h2 id="bug-report-title" className="text-base font-semibold">Bug Report Saved</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn-icon">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        
        <div className="text-center py-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/10 mb-4">
            <CheckCircle size={32} className="text-green-500" />
          </div>
          <h3 className="text-lg font-medium mb-2">Your report is saved</h3>
          <p className="text-sm text-app-text-secondary mb-6">
            Your report was saved as a text file. Attach it when reporting the issue to the project.
          </p>
          
          {error && <p role="alert" className="text-sm text-app-danger mb-3">{error}</p>}
          <div className="flex gap-3 justify-center">
            <button
              type="button"
              onClick={handleCopyToClipboard}
              className="btn px-4 py-2 text-sm"
            >
              {copied ? "Copied" : "Copy Report"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn px-4 py-2 text-sm"
            >
              Close
            </button>
          </div>
        </div>
      </dialog>
    );
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="bug-report-title"
      className="about-dialog w-[calc(100%_-_2rem)] max-w-lg max-h-[85vh] overflow-y-auto p-5"
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.target === event.currentTarget &&
          (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) onClose();
      }}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <Bug size={20} className="text-app-accent" />
          <h2 id="bug-report-title" className="text-base font-semibold">Report a Bug</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="btn-icon">
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 p-3 mb-4 text-sm text-red-500 bg-red-500/10 rounded-lg">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label htmlFor="title" className="block text-sm font-medium mb-1">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="title"
            name="title"
            value={report.title}
            onChange={handleChange}
            required
            placeholder="Brief description of the issue"
            className="input"
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1">
            Email
          </label>
          <input
            type="email"
            id="email"
            name="email"
            value={report.email}
            onChange={handleChange}
            placeholder="your@email.com (optional, for follow-up)"
            className="input"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="category" className="block text-sm font-medium mb-1">
              Category
            </label>
            <Select
              id="category"
              name="category"
              value={report.category}
              onChange={handleChange}
            >
              <option value="bug">Bug</option>
              <option value="error">Error</option>
              <option value="crash">Crash</option>
              <option value="performance">Performance</option>
              <option value="other">Other</option>
            </Select>
          </div>

          <div>
            <label htmlFor="severity" className="block text-sm font-medium mb-1">
              Severity
            </label>
            <Select
              id="severity"
              name="severity"
              value={report.severity}
              onChange={handleChange}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </Select>
          </div>
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium mb-1">
            Description <span className="text-red-500">*</span>
          </label>
          <textarea
            id="description"
            name="description"
            value={report.description}
            onChange={handleChange}
            required
            rows={3}
            placeholder="Detailed description of the issue"
            className="input resize-none"
          />
        </div>

        <div>
          <label htmlFor="stepsToReproduce" className="block text-sm font-medium mb-1">
            Steps to Reproduce
          </label>
          <textarea
            id="stepsToReproduce"
            name="stepsToReproduce"
            value={report.stepsToReproduce}
            onChange={handleChange}
            rows={3}
            placeholder="1. Go to...&#10;2. Click on...&#10;3. See error"
            className="input resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="expectedBehavior" className="block text-sm font-medium mb-1">
              Expected Behavior
            </label>
            <textarea
              id="expectedBehavior"
              name="expectedBehavior"
              value={report.expectedBehavior}
              onChange={handleChange}
              rows={2}
              placeholder="What should happen"
              className="input resize-none"
            />
          </div>

          <div>
            <label htmlFor="actualBehavior" className="block text-sm font-medium mb-1">
              Actual Behavior
            </label>
            <textarea
              id="actualBehavior"
              name="actualBehavior"
              value={report.actualBehavior}
              onChange={handleChange}
              rows={2}
              placeholder="What actually happens"
              className="input resize-none"
            />
          </div>
        </div>

        <div>
          <label htmlFor="errorMessages" className="block text-sm font-medium mb-1">
            Error Messages
          </label>
          <textarea
            id="errorMessages"
            name="errorMessages"
            value={report.errorMessages}
            onChange={handleChange}
            rows={3}
            placeholder="Paste any error messages here"
            className="input resize-none font-mono text-xs"
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="btn px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving || !report.title || !report.description}
            className="btn btn-primary px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Download size={14} />
                Save Report
              </>
            )}
          </button>
        </div>
      </form>
    </dialog>
  );
}