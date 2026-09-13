import { getCurrentWindow } from "@tauri-apps/api/window";
import { Info, Minus, Moon, Settings, Sun, Terminal, X } from "lucide-react";

interface AppHeaderProps {
  theme: "dark" | "light";
  showConsole: boolean;
  showSettings: boolean;
  onAbout: () => void;
  onConsole: () => void;
  onSettings: () => void;
  onTheme: () => void;
  onWindowError: (message: string) => void;
}

export default function AppHeader(props: AppHeaderProps) {
  const windowAction = async (action: "minimize" | "close") => {
    try {
      await getCurrentWindow()[action]();
    } catch (error) {
      console.error(`[window] Failed to ${action}`, error);
      props.onWindowError(`Could not ${action} the window. Please try again.`);
    }
  };

  return (
    <header className="app-header" data-tauri-drag-region>
      <div className="app-brand" data-tauri-drag-region>
        <img className="app-brand-mark" src="/app-icon.png" width={34} height={34} alt="" draggable={false} />
        <span className="app-brand-name">Converter</span>
      </div>
      <div className="app-drag-space" data-tauri-drag-region />
      <div className="app-tools" role="group" aria-label="Application tools">
        <button type="button" className="header-control" onClick={props.onAbout}
          aria-label="About and updates" data-tooltip="About & updates">
          <Info size={17} aria-hidden="true" />
        </button>
        <button type="button" className="header-control" onClick={props.onConsole}
          aria-label="Console" aria-pressed={props.showConsole} aria-keyshortcuts="Control+Shift+D"
          data-tooltip="Console · Ctrl+Shift+D">
          <Terminal size={17} aria-hidden="true" />
        </button>
        <button type="button" className="header-control" onClick={props.onSettings}
          aria-label="Settings" aria-pressed={props.showSettings} aria-keyshortcuts="Control+,"
          data-tooltip="Settings · Ctrl+,">
          <Settings size={17} aria-hidden="true" />
        </button>
        <button type="button" className="header-control" onClick={props.onTheme}
          aria-label={`Switch to ${props.theme === "dark" ? "light" : "dark"} theme`}
          data-tooltip={`${props.theme === "dark" ? "Light" : "Dark"} theme`}>
          {props.theme === "dark" ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
        </button>
      </div>
      <div className="window-controls" role="group" aria-label="Window controls">
        <button type="button" className="header-control window-control" onClick={() => void windowAction("minimize")}
          aria-label="Minimize window" data-tooltip="Minimize">
          <Minus size={18} aria-hidden="true" />
        </button>
        <button type="button" className="header-control window-control window-close" onClick={() => void windowAction("close")}
          aria-label="Close window" data-tooltip="Close">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
