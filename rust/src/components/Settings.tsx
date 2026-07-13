import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { open } from "@tauri-apps/plugin-dialog";
import {
  getSettings,
  saveSettings,
  resetSettings,
  getDefaultDownloadDir,
} from "../lib/tauri-commands";
import type { AppSettings } from "../lib/tauri-commands";
import {
  FolderOpen,
  Download,
  ArrowRightLeft,
  RotateCcw,
  Check,
  AlertCircle,
  Folder,
} from "lucide-react";

interface Props {
  onSettingsChanged: (settings: AppSettings) => void;
  disabled: boolean;
}

function isValidPath(p: string): boolean {
  if (!p.trim()) return true;
  return !/[<>"|?*]/.test(p);
}

export default function Settings({ onSettingsChanged, disabled }: Props) {
  const [settings, setSettings] = useState<AppSettings>({
    downloadDir: "",
    outputDir: "",
    autoSave: false,
    overwriteExisting: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [saveMessage, setSaveMessage] = useState<"ok" | "error" | null>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isBusy = saving || resetting;

  const clearMessageTimer = useCallback(() => {
    if (messageTimer.current) {
      clearTimeout(messageTimer.current);
      messageTimer.current = null;
    }
  }, []);

  useEffect(() => {
    loadSettings();
    return () => clearMessageTimer();
  }, []);

  const loadSettings = async () => {
    try {
      const s = await getSettings();
      setSettings(s);
      onSettingsChanged(s);
    } catch {
      let defaultDir = "";
      try {
        defaultDir = await getDefaultDownloadDir();
      } catch {
        defaultDir = "";
      }
      const fallback: AppSettings = {
        downloadDir: defaultDir,
        outputDir: "",
        autoSave: false,
        overwriteExisting: false,
      };
      setSettings(fallback);
      onSettingsChanged(fallback);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!isValidPath(settings.downloadDir) || !isValidPath(settings.outputDir)) {
      setSaveMessage("error");
      clearMessageTimer();
      messageTimer.current = setTimeout(() => setSaveMessage(null), 3000);
      return;
    }
    setSaving(true);
    setSaveMessage(null);
    clearMessageTimer();
    try {
      const saved = await saveSettings(settings);
      setSettings(saved);
      onSettingsChanged(saved);
      setSaveMessage("ok");
      messageTimer.current = setTimeout(() => setSaveMessage(null), 2000);
    } catch {
      setSaveMessage("error");
      messageTimer.current = setTimeout(() => setSaveMessage(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    setSaveMessage(null);
    clearMessageTimer();
    try {
      const defaults = await resetSettings();
      setSettings(defaults);
      onSettingsChanged(defaults);
      setSaveMessage("ok");
      messageTimer.current = setTimeout(() => setSaveMessage(null), 2000);
    } catch {
      setSaveMessage("error");
      messageTimer.current = setTimeout(() => setSaveMessage(null), 3000);
    } finally {
      setResetting(false);
    }
  };

  const pickFolder = async (current: string, onSelect: (path: string) => void) => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: current || undefined,
        title: "Select folder",
      });
      if (selected) {
        onSelect(selected as string);
      }
    } catch (err) {
      console.error("Folder picker failed:", err);
    }
  };

  if (loading) {
    return (
      <div className="glass-panel p-6 text-center">
        <p className="text-sm text-glass-text-muted">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Download Directory */}
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel p-4 space-y-3"
      >
        <div className="flex items-center gap-2">
          <Download size={14} className="text-glass-accent" />
          <span className="text-xs font-semibold text-glass-text-dim uppercase tracking-wider">
            Download Directory
          </span>
        </div>
        <p className="text-[10px] text-glass-text-muted">
          Where URL downloads are saved by default.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={settings.downloadDir}
            onChange={(e) =>
              setSettings((prev) => ({ ...prev, downloadDir: e.target.value }))
            }
            disabled={disabled}
            className="glass-input flex-1 text-xs"
            placeholder="Downloads folder"
          />
          <button
            onClick={() =>
              pickFolder(settings.downloadDir, (dir) =>
                setSettings((prev) => ({ ...prev, downloadDir: dir }))
              )
            }
            disabled={disabled}
            className="glass-btn px-3 py-2"
            title="Browse for folder"
          >
            <FolderOpen size={14} />
          </button>
        </div>
      </motion.div>

      {/* Output Directory */}
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="glass-panel p-4 space-y-3"
      >
        <div className="flex items-center gap-2">
          <ArrowRightLeft size={14} className="text-glass-accent" />
          <span className="text-xs font-semibold text-glass-text-dim uppercase tracking-wider">
            Output Directory
          </span>
        </div>
        <p className="text-[10px] text-glass-text-muted">
          Where converted, compressed, and blurred files are saved when auto-save is on.
          Leave empty to save next to the original file.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={settings.outputDir}
            onChange={(e) =>
              setSettings((prev) => ({ ...prev, outputDir: e.target.value }))
            }
            disabled={disabled}
            className="glass-input flex-1 text-xs"
            placeholder="Same as input file"
          />
          <button
            onClick={() =>
              pickFolder(settings.outputDir, (dir) =>
                setSettings((prev) => ({ ...prev, outputDir: dir }))
              )
            }
            disabled={disabled}
            className="glass-btn px-3 py-2"
            title="Browse for folder"
          >
            <FolderOpen size={14} />
          </button>
        </div>
      </motion.div>

      {/* Auto-save toggle */}
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-panel p-4 flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <Folder size={14} className="text-glass-accent" />
          <div>
            <span className="text-xs font-semibold text-glass-text-dim uppercase tracking-wider">
              Auto-Save
            </span>
            <p className="text-[10px] text-glass-text-muted mt-0.5">
              Automatically save output files to the Output Directory.
            </p>
          </div>
        </div>
        <button
          onClick={() =>
            setSettings((prev) => ({ ...prev, autoSave: !prev.autoSave }))
          }
          disabled={disabled}
          className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${
            settings.autoSave
              ? "bg-glass-accent"
              : "bg-glass-surface border border-glass-border"
          }`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              settings.autoSave ? "translate-x-5.5" : "translate-x-0.5"
            }`}
          />
        </button>
      </motion.div>

      {/* Overwrite toggle */}
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="glass-panel p-4 flex items-center justify-between"
      >
        <div>
          <span className="text-xs font-semibold text-glass-text-dim uppercase tracking-wider">
            Overwrite Existing
          </span>
          <p className="text-[10px] text-glass-text-muted mt-0.5">
            Replace files that already exist at the output path.
          </p>
        </div>
        <button
          onClick={() =>
            setSettings((prev) => ({
              ...prev,
              overwriteExisting: !prev.overwriteExisting,
            }))
          }
          disabled={disabled}
          className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${
            settings.overwriteExisting
              ? "bg-glass-accent"
              : "bg-glass-surface border border-glass-border"
          }`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              settings.overwriteExisting ? "translate-x-5.5" : "translate-x-0.5"
            }`}
          />
        </button>
      </motion.div>

      {/* Save / Reset buttons */}
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="flex gap-2"
      >
        <button
          onClick={handleSave}
          disabled={disabled || isBusy}
          className="flex-1 glass-btn glass-btn-primary py-2.5"
        >
          {saving ? (
            "Saving..."
          ) : saveMessage === "ok" ? (
            <>
              <Check size={14} /> Saved
            </>
          ) : saveMessage === "error" ? (
            <>
              <AlertCircle size={14} /> Error
            </>
          ) : (
            "Save Settings"
          )}
        </button>
        <button
          onClick={handleReset}
          disabled={disabled || isBusy}
          className="glass-btn py-2.5 px-4"
          title="Reset to defaults"
        >
          {resetting ? "Resetting..." : (
            <>
              <RotateCcw size={14} />
              Reset
            </>
          )}
        </button>
      </motion.div>

      <p className="text-[10px] text-glass-text-muted text-center">
        Settings are saved to your system's config folder and persist across app restarts.
      </p>
    </div>
  );
}
