import { AlertCircle, ArrowUpCircle, CheckCircle2, ChevronDown, Download, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { checkForUpdate, downloadAndInstallUpdate, isUpdateBusy, restartAfterUpdate, useUpdater } from "../lib/updater";
import { formatFileSize } from "../lib/file-size";
import ReleaseNotes from "./ReleaseNotes";

interface Props {
  hasPendingWork: boolean;
}

export default function UpdatePanel({ hasPendingWork }: Props) {
  const update = useUpdater();
  const busy = isUpdateBusy(update.status);
  const canInstall = update.status === "update_available" || (update.status === "error" && update.failedAction === "install");
  const restartFailed = update.failedAction === "restart";
  const needsRestart = update.downloaded && !busy;
  const percent = update.totalBytes ? Math.min(100, Math.round(update.downloadedBytes / update.totalBytes * 100)) : null;
  const statusText = {
    idle: update.downloaded ? "Update installed. Restart Converter to finish." : "Check for a newer version when you're ready.",
    checking: "Checking for updates…",
    update_available: "A new version is ready to install.",
    up_to_date: "You're using the latest version.",
    downloading: "Downloading your update…",
    installing: "Verifying and installing…",
    restarting: "Update installed. Restarting Converter…",
    error: restartFailed ? "Update installed, but automatic restart failed." : update.failedAction === "install" ? "Update installation failed." : "Unable to check for updates.",
  }[update.status];
  const StatusIcon = busy ? Loader2 : update.status === "error" ? AlertCircle : update.status === "up_to_date" || update.downloaded ? CheckCircle2 : ArrowUpCircle;
  const statusColor = update.status === "error" ? "text-app-danger" : update.status === "up_to_date" || update.downloaded ? "text-app-success" : "text-app-accent";

  return (
    <section aria-labelledby="update-title" className="update-panel">
      <h3 id="update-title" className="text-sm font-semibold">Software updates</h3>
      <div className="update-summary">
        <div className={`update-status-icon ${statusColor}`}>
          <StatusIcon size={24} strokeWidth={1.6} aria-hidden="true" className={busy ? "animate-spin motion-reduce:animate-none" : undefined} />
        </div>
        <div className="min-w-0">
          <p className="update-version">Converter {update.version ?? update.currentVersion}</p>
          <p role="status" aria-live="polite" className="update-status">{statusText}</p>
        </div>
      </div>
      {update.error && (
        <div role="alert" className="update-error">
          <p className="break-words">{update.error}</p>
          <p className="text-app-text-secondary">{restartFailed ? "Try restarting again, or close and reopen Converter." : "You can retry when ready. Converter will continue to work normally."}</p>
        </div>
      )}
      {update.status === "downloading" && (
        <div className="update-download">
          <progress className="update-progress w-full h-2" max={100} value={percent ?? undefined} aria-label="Update download" />
          <p className="text-xs text-app-text-secondary tabular-nums">
            {formatFileSize(update.downloadedBytes)}{update.totalBytes ? ` of ${formatFileSize(update.totalBytes)} · ${percent}%` : " downloaded"}
          </p>
        </div>
      )}
      {update.notes && (
        <details className="update-notes" open={canInstall || needsRestart}>
          <summary>
            <span>What's new{update.version ? ` in v${update.version}` : ""}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <div className="update-notes-content" role="region" aria-label="Release notes" tabIndex={0}>
            <ReleaseNotes notes={update.notes} />
          </div>
        </details>
      )}
      {(canInstall || needsRestart) && hasPendingWork && <p className="text-xs text-app-warning">Finish or remove queued media jobs before {needsRestart ? "restarting Converter" : "installing the update"}.</p>}
      <div className="update-actions">
        {canInstall && (
          <button type="button" onClick={() => { if (!hasPendingWork) void downloadAndInstallUpdate(); }} disabled={hasPendingWork || busy} className="btn btn-primary">
            <Download size={14} aria-hidden="true" /> {update.failedAction === "install" ? "Retry Update" : "Install & Restart"}
          </button>
        )}
        {needsRestart && <button type="button" onClick={() => void restartAfterUpdate()} disabled={busy || hasPendingWork} className="btn btn-primary">Restart Converter</button>}
        <button type="button" onClick={() => void checkForUpdate()} disabled={busy || update.downloaded} className="btn">
          <RefreshCw size={14} aria-hidden="true" /> Check for Updates
        </button>
      </div>
      {(canInstall || needsRestart) && <p className="update-caption">Installing closes and restarts Converter. Your settings are kept.</p>}
      <p className="update-trust"><ShieldCheck size={13} aria-hidden="true" /> Verified updates from GitHub Releases</p>
    </section>
  );
}
