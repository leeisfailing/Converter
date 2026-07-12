/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["selector", "[data-theme='dark']"],
  theme: {
    extend: {
      colors: {
        glass: {
          bg: "var(--bg)",
          surface: "var(--surface)",
          "surface-hover": "var(--surface-hover)",
          border: "var(--border)",
          "border-hover": "var(--border-hover)",
          accent: "var(--accent)",
          "accent-dim": "var(--accent-dim)",
          "accent-glow": "var(--accent-glow)",
          "accent-text": "var(--accent-text)",
          text: "var(--text)",
          "text-dim": "var(--text-dim)",
          "text-muted": "var(--text-muted)",
          danger: "var(--danger)",
          "danger-dim": "var(--danger-dim)",
          success: "var(--success)",
          "success-dim": "var(--success-dim)",
        },
      },
      backdropBlur: {
        glass: "20px",
      },
      borderRadius: {
        glass: "14px",
        "glass-sm": "10px",
      },
      boxShadow: {
        glass: "0 8px 32px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
        "glass-hover": "0 8px 32px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.08)",
        glow: "0 0 20px var(--accent-dim)",
      },
      fontFamily: {
        sans: ['"Inter"', '"SF Pro Display"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        display: ['"DM Serif Display"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', '"SF Mono"', '"Fira Code"', 'monospace'],
      },
    },
  },
  plugins: [],
};
