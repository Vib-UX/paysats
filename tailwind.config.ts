import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0A0A0A",
        gold: "#FFD700",
        orange: "#F7931A",
        card: "#121212",
        border: "#222222"
      }
    }
  },
  plugins: []
};

export default config;
