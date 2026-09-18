import { ArrowDownToLine, ArrowRight, Film, Loader2, ScanLine } from "lucide-react";
import type { UrlFormat } from "../lib/tauri-commands";
import "./TikTokDownloadOptions.css";

interface Props {
  formats: UrlFormat[];
  disabled: boolean;
  pending: string;
  onDownload: (mode: string) => void;
}

export default function TikTokDownloadOptions({ formats, disabled, pending, onDownload }: Props) {
  return (
    <section className="panel overflow-hidden" aria-label="TikTok download options">
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-4">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.16em] uppercase text-app-text-muted">TikTok video</p>
          <h3 className="mt-1 text-base font-semibold tracking-tight text-app-text">Save your video</h3>
        </div>
        <span className="rounded-md border border-app-border px-2 py-1 font-mono text-[10px] text-app-text-secondary">MP4</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-5 pb-5">
        {[
          { mode: "tiktok", label: "Download", title: "Original look", description: "Keeps the TikTok watermark.", Icon: Film },
          { mode: "tiktok_no_watermark", label: "No Watermark Download", title: "A cleaner frame", description: "Without the TikTok watermark.", Icon: ScanLine },
        ].map(({ mode, label, title, description, Icon }) => {
          const format = formats.find(f => f.value === mode);
          const available = format?.available !== false;
          const clean = mode === "tiktok_no_watermark";
          const size = format?.filesize ? `~${(format.filesize / 1_000_000).toFixed(1)} MB` : 'Video + audio';
          return (
            <div key={mode} className={`rounded-xl border p-4 flex flex-col ${clean ? 'border-app-accent bg-app-accent-dim' : 'border-app-border bg-app-bg-secondary'}`}>
              <div className="flex items-center justify-between gap-2 mb-5">
                <Icon size={20} aria-hidden="true" className={clean ? 'text-app-accent' : 'text-app-text-secondary'} />
                <span className="text-[10px] font-mono text-app-text-secondary">{available ? size : 'Unavailable'}</span>
              </div>
              <h4 className="text-sm font-semibold text-app-text">{title}</h4>
              <p className="mt-1 mb-4 text-xs leading-relaxed text-app-text-secondary">{description}</p>
              <button type="button" aria-label={label} aria-busy={pending === mode}
                disabled={disabled || !!pending || !available}
                onClick={() => onDownload(mode)}
                className={`tiktok-action ${clean ? 'tiktok-action-primary' : ''}`}>
                {pending === mode ? <Loader2 size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <ArrowDownToLine size={14} aria-hidden="true" />}
                {pending === mode ? 'Adding to queue…' : label}
              </button>
              {!available && <p className="mt-2 text-xs text-app-text-muted">This version isn’t available for this video.</p>}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 border-t border-app-border px-5 py-3 text-[11px] text-app-text-secondary">
        <ArrowRight size={12} aria-hidden="true" />
        Downloads are added to your queue. Track progress there.
      </div>
    </section>
  );
}
