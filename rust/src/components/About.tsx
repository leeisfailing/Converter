import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { isUpdateBusy, useUpdater } from "../lib/updater";
import UpdatePanel from "./UpdatePanel";

interface Props {
  onClose: () => void;
  hasPendingWork: boolean;
}

export default function About({ onClose, hasPendingWork }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const updater = useUpdater();
  const locked = isUpdateBusy(updater.status) && updater.status !== "checking";

  useEffect(() => {
    const dialog = dialogRef.current!;
    const trigger = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement) trigger.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="about-title"
      className="about-dialog w-[calc(100%_-_2rem)] max-w-lg max-h-[85vh] overflow-y-auto p-5"
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => { event.preventDefault(); if (!locked) onClose(); }}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (!locked && event.target === event.currentTarget &&
          (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) onClose();
      }}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 id="about-title" className="text-base font-semibold">About Converter</h2>
          <p className="text-xs text-app-text-secondary mt-1">Media downloader, converter, and motion blur tool by Lee.</p>
        </div>
        <button type="button" onClick={onClose} disabled={locked} aria-label="Close About" className="btn-icon disabled:opacity-40">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="flex justify-between border-b border-app-border pb-4 mb-4 text-xs">
        <span className="text-app-text-secondary">Installed version</span>
        <span className="font-mono">v{updater.currentVersion}</span>
      </div>
      <UpdatePanel hasPendingWork={hasPendingWork} />
      <div className="flex justify-end mt-4">
        <button type="button" onClick={onClose} disabled={locked} className="btn px-4 py-2 text-xs">
          {updater.status === "update_available" ? "Later" : "Close"}
        </button>
      </div>
    </dialog>
  );
}
