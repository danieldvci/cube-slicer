import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        void: {
          50: "#e8e8f0",
          100: "#d0d0e0",
          200: "#a0a0c0",
          300: "#7070a0",
          400: "#404080",
          500: "#1a1a2e",
          600: "#141428",
          700: "#0e0e1e",
          800: "#0a0a15",
          900: "#06060e",
        },
        accent: {
          teal: "#2A9D8F",
          blue: "#457B9D",
          red: "#E63946",
          gold: "#E9C46A",
          orange: "#F4A261",
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"SF Mono"', '"Fira Code"', "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
