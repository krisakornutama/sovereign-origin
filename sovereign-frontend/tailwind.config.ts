import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/stores/**/*.{js,ts,jsx,tsx}",
    "./src/hooks/**/*.{js,ts,jsx,tsx}",
    "./src/lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Sovereign surfaces — โทนเข้มเงียบ ไล่ระดับพื้นผิวแบบโปรดักชัน
        gray: {
          50: "#f4f6f9",
          100: "#e8ecf2",
          200: "#d7dde7",
          300: "#b9c2cf",
          400: "#93a0b0",
          500: "#6b7889",
          600: "#4b5666",
          700: "#333d4c",
          800: "#1d2430",
          900: "#131924",
          950: "#0b0f16",
        },
      },
      fontFamily: {
        sans: [
          "Prompt",
          "Noto Sans Thai Looped",
          "IBM Plex Sans Thai",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "Cascadia Code",
          "Courier New",
          "monospace",
        ],
      },
      borderRadius: {
        xl: "0.75rem",
        "2xl": "1rem",
      },
      boxShadow: {
        "neon-green": "0 0 0 1px rgba(52,211,153,0.18), 0 0 18px rgba(52,211,153,0.14), 0 0 42px rgba(52,211,153,0.05)",
        "neon-green-sm": "0 0 0 1px rgba(52,211,153,0.22), 0 0 12px rgba(52,211,153,0.16)",
        "neon-cyan": "0 0 0 1px rgba(34,211,238,0.18), 0 0 18px rgba(34,211,238,0.14), 0 0 42px rgba(34,211,238,0.05)",
        "neon-cyan-sm": "0 0 0 1px rgba(34,211,238,0.22), 0 0 12px rgba(34,211,238,0.16)",
        "neon-red": "0 0 0 1px rgba(251,113,133,0.2), 0 0 14px rgba(251,113,133,0.15)",
      },
    },
  },
  plugins: [],
};
export default config;