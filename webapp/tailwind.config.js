/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0b1220",
        panel: "#111a2e",
        panelHi: "#182545",
        border: "#26355e",
        accent: "#4dabf7",
        good: "#37d67a",
        warn: "#f5a524",
        bad: "#f14a4a",
      },
    },
  },
  plugins: [],
};
