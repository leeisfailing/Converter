/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        glass: {
          bg: "#0f1117",
          panel: "rgba(255, 255, 255, 0.04)",
          border: "rgba(255, 255, 255, 0.08)",
          "border-hover": "rgba(255, 255, 255, 0.15)",
          accent: "#5dadec",
          "accent-dim": "rgba(93, 173, 236, 0.15)",
          "accent-glow": "rgba(93, 173, 236, 0.25)",
          text: "rgba(255, 255, 255, 0.88)",
          "text-dim": "rgba(255, 255, 255, 0.45)",
          "text-muted": "rgba(255, 255, 255, 0.25)",
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
        glass: "0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
        "glass-hover": "0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08)",
        glow: "0 0 20px rgba(93, 173, 236, 0.15)",
      },
      fontFamily: {
        sans: ['"Inter"', '"SF Pro Display"', '"Segoe UI"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
