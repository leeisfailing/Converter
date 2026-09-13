import { motion, AnimatePresence } from "framer-motion";
import { Download, X } from "lucide-react";
import { useUpdater } from "../lib/updater";

const DISMISSED_KEY = "converter-update-dismissed";

function getDismissedVersion(): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(DISMISSED_KEY) : null;
  } catch {
    return null;
  }
}

function saveDismissedVersion(version: string) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(DISMISSED_KEY, version);
  } catch {}
}

export function clearDismissedVersion() {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(DISMISSED_KEY);
  } catch {}
}

interface Props {
  onOpenAbout: () => void;
}

export default function UpdatePrompt({ onOpenAbout }: Props) {
  const update = useUpdater();
  const dismissed = getDismissedVersion();
  const shouldShow = update.status === "update_available" && update.version && dismissed !== update.version;

  function handleDismiss() {
    if (update.version) saveDismissedVersion(update.version);
  }

  function handleUpdate() {
    onOpenAbout();
  }

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 40, scale: 0.95 }}
          transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
          className="fixed bottom-4 left-4 z-40 max-w-sm"
        >
          <div className="rounded-xl border border-app-border bg-app-surface shadow-panel-lg p-4">
            <div className="flex items-start gap-3">
              <div className="shrink-0 mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-app-accent-dim">
                <Download size={16} className="text-app-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-app-text">Update available</p>
                <p className="text-xs text-app-text-secondary mt-0.5">
                  Converter {update.version} is ready to install.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDismiss}
                className="shrink-0 p-1 rounded-lg text-app-text-muted hover:text-app-text hover:bg-app-surface-hover transition-colors"
                aria-label="Dismiss update notification"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex gap-2 mt-3 ml-11">
              <button
                type="button"
                onClick={handleUpdate}
                className="btn btn-primary px-3 py-1.5 text-xs"
              >
                Update
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                className="btn px-3 py-1.5 text-xs"
              >
                Later
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
