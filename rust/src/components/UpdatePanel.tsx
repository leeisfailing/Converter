import { motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Download, Loader2, RefreshCw } from "lucide-react";
import { checkForUpdate, downloadAndInstallUpdate, isUpdateBusy, restartAfterUpdate, useUpdater } from "../lib/updater";

function formatBytes(bytes: number) {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export default function UpdatePanel({ hasPendingWork }: { hasPendingWork: boolean }) {
  const update = useUpdater();
  const busy = isUpdateBusy(update.status);
  const canInstall = update.status === "update_available" || (update.status === "error" && update.failedAction === "install");
  const restartFailed = update.failedAction === "restart";
  const percent = update.totalBytes ? Math.min(100, Math.round(update.downloadedBytes / update.totalBytes * 100)) : null;
  const statusText = {
    idle: "Check for a newer version of Converter.",
    checking: "Checking for updates...",
    update_available: `Version ${update.version} is available.`,
    up_to_date: `You're up to date on v${update.currentVersion}.`,
    downloading: "Downloading update...",
    installing: "Verifying and installing update...",
    restarting: "Update installed. Restarting Converter...",
    error: restartFailed ? "Update installed, but automatic restart failed." : update.failedAction === "install" ? "Update installation failed." : "Unable to check for updates.",
  }[update.status];

  return (
    <section aria-labelledby="update-title" className="space-y-3">
      <h3 id="update-title" className="text-sm font-semibold">Software updates</h3>
      <p className="text-xs text-app-text-secondary">Checks run when you request them. Installing an update will close and restart Converter.</p>
      <motion.div
        role="status"
        aria-live="polite"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-start gap-2 text-sm"
      >
        {busy && <Loader2 size={16} aria-hidden="true" className="shrink-0 mt-0.5 animate-spin motion-reduce:animate-none text-app-accent" />}
        {update.status === "error" && <AlertCircle size={16} aria-hidden="true" className="shrink-0 mt-0.5 text-app-danger" />}
        {update.status === "up_to_date" && <CheckCircle2 size={16} aria-hidden="true" className="shrink-0 mt-0.5 text-app-success" />}
        <span>{statusText}</span>
      </motion.div>
      {update.error && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg bg-app-danger-dim p-3 text-xs space-y-1"
        >
          <p className="break-words">{update.error}</p>
          <p className="text-app-text-secondary">{restartFailed ? "Try restarting again, or close and reopen Converter." : "You can retry when ready. Converter will continue to work normally."}</p>
        </motion.div>
      )}
      {update.status === "downloading" && (
        <div className="space-y-1">
          <progress className="update-progress w-full h-2" max={100} value={percent ?? undefined} aria-label="Update download" />
          <p className="text-xs text-app-text-secondary font-mono">
            {formatBytes(update.downloadedBytes)}{update.totalBytes ? ` / ${formatBytes(update.totalBytes)} (${percent}%)` : " downloaded"}
          </p>
        </div>
      )}
      {update.notes && (
        <details className="rounded-lg border border-app-border p-3">
          <summary className="cursor-pointer text-xs font-medium">What's new in v{update.version}</summary>
          <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-xs text-app-text-secondary">{update.notes}</p>
        </details>
      )}
      {canInstall && hasPendingWork && <p className="text-xs text-app-warning">Finish or remove queued media jobs before installing the update.</p>}
      <div className="flex flex-wrap gap-2">
        <motion.button type="button" onClick={() => void checkForUpdate()} disabled={busy || restartFailed} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} className="btn px-3 py-2 text-xs">
          <RefreshCw size={14} aria-hidden="true" /> Check for Updates
        </motion.button>
        {canInstall && (
          <motion.button type="button" onClick={() => { if (!hasPendingWork) void downloadAndInstallUpdate(); }} disabled={hasPendingWork || busy} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} className="btn btn-primary px-3 py-2 text-xs">
            <Download size={14} aria-hidden="true" /> {update.failedAction === "install" ? "Retry Update" : "Install & Restart"}
          </motion.button>
        )}
        {restartFailed && <button type="button" onClick={() => void restartAfterUpdate()} disabled={busy || hasPendingWork} className="btn btn-primary px-3 py-2 text-xs">Restart Converter</button>}
      </div>
      <p className="text-xs text-app-text-secondary">Updates come from GitHub Releases and are verified before installation.</p>
    </section>
  );
}
