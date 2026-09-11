/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["selector", "[data-theme='dark']"],
  theme: {
    extend: {
      colors: {
        app: {
          bg: "var(--bg)",
          "bg-secondary": "var(--bg-secondary)",
          surface: "var(--surface)",
          "surface-elevated": "var(--surface-elevated)",
          "surface-hover": "var(--surface-hover)",
          border: "var(--border)",
          "border-hover": "var(--border-hover)",
          accent: "var(--accent)",
          "accent-hover": "var(--accent-hover)",
          "accent-dim": "var(--accent-dim)",
          "accent-glow": "var(--accent-glow)",
          text: "var(--text)",
          "text-secondary": "var(--text-secondary)",
          "text-muted": "var(--text-muted)",
          danger: "var(--danger)",
          "danger-dim": "var(--danger-dim)",
          success: "var(--success)",
          "success-dim": "var(--success-dim)",
          warning: "var(--warning)",
          "warning-dim": "var(--warning-dim)",
        },
      },
      borderRadius: {
        panel: "12px",
        "panel-sm": "8px",
      },
      boxShadow: {
        panel: "0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)",
        "panel-lg": "0 4px 12px rgba(0, 0, 0, 0.15), 0 2px 4px rgba(0, 0, 0, 0.1)",
        glow: "0 0 20px var(--accent-glow)",
      },
      fontFamily: {
        sans: ['"Inter"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"SF Mono"', '"Fira Code"', 'monospace'],
      },
      animation: {
        "spin-slow": "spin 2s linear infinite",
      },
    },
  },
  plugins: [],
};
