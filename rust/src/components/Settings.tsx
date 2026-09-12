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
  Info,
} from "lucide-react";

interface Props {
  onSettingsChanged: (settings: AppSettings) => void;
  disabled: boolean;
  onOpenAbout: () => void;
}

function isValidPath(p: string): boolean {
  if (!p.trim()) return true;
  return !/[<>"|?*]/.test(p);
}

export default function Settings({ onSettingsChanged, disabled, onOpenAbout }: Props) {
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
      <div className="panel p-6 text-center">
        <p className="text-sm text-app-text-muted">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Download Directory */}
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        className="panel p-4 space-y-3"
      >
        <div className="flex items-center gap-2">
          <Download size={14} className="text-app-accent" />
          <span className="text-xs font-semibold text-app-text-secondary uppercase tracking-wider">
            Download Directory
          </span>
        </div>
        <p className="text-[11px] text-app-text-muted">
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
            className="input flex-1 text-xs"
            placeholder="Downloads folder"
          />
          <button
            onClick={() =>
              pickFolder(settings.downloadDir, (dir) =>
                setSettings((prev) => ({ ...prev, downloadDir: dir }))
              )
            }
            disabled={disabled}
            className="btn px-3 py-2"
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
        className="panel p-4 space-y-3"
      >
        <div className="flex items-center gap-2">
          <ArrowRightLeft size={14} className="text-app-accent" />
          <span className="text-xs font-semibold text-app-text-secondary uppercase tracking-wider">
            Output Directory
          </span>
        </div>
        <p className="text-[11px] text-app-text-muted">
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
            className="input flex-1 text-xs"
            placeholder="Same as input file"
          />
          <button
            onClick={() =>
              pickFolder(settings.outputDir, (dir) =>
                setSettings((prev) => ({ ...prev, outputDir: dir }))
              )
            }
            disabled={disabled}
            className="btn px-3 py-2"
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
        className="panel p-4 flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <Folder size={14} className="text-app-accent" />
          <div>
            <span className="text-xs font-semibold text-app-text-secondary uppercase tracking-wider">
              Auto-Save
            </span>
            <p className="text-[11px] text-app-text-muted mt-0.5">
              Automatically save output files to the Output Directory.
            </p>
          </div>
        </div>
        <button
          onClick={() =>
            setSettings((prev) => ({ ...prev, autoSave: !prev.autoSave }))
          }
          disabled={disabled}
          className={`toggle ${settings.autoSave ? "active" : ""}`}
        />
      </motion.div>

      {/* Overwrite toggle */}
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="panel p-4 flex items-center justify-between"
      >
        <div>
          <span className="text-xs font-semibold text-app-text-secondary uppercase tracking-wider">
            Overwrite Existing
          </span>
          <p className="text-[11px] text-app-text-muted mt-0.5">
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
          className={`toggle ${settings.overwriteExisting ? "active" : ""}`}
        />
      </motion.div>

      {/* Save / Reset buttons */}
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="flex gap-2"
      >
          <motion.button
            onClick={handleSave}
            disabled={disabled || isBusy}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            className="flex-1 btn btn-primary py-2.5"
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
        </motion.button>
        <motion.button
          onClick={handleReset}
          disabled={disabled || isBusy}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          className="btn py-2.5 px-4"
          title="Reset to defaults"
        >
          {resetting ? "Resetting..." : (
            <>
              <RotateCcw size={14} />
              Reset
            </>
          )}
        </motion.button>
      </motion.div>

      <motion.button
        type="button"
        onClick={onOpenAbout}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.98 }}
        className="w-full btn py-2.5 text-xs"
      >
        <Info size={14} aria-hidden="true" /> About & Updates
      </motion.button>

      <p className="text-[11px] text-app-text-muted text-center">
        Settings are saved to your system's config folder and persist across app restarts.
      </p>
    </div>
  );
}
