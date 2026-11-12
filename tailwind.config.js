/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Misma paleta que la landing
      colors: {
        carbon: "#121212",
        asphalt: { DEFAULT: "#1E1E22", light: "#2A2A30", lighter: "#36363E" },
        flame: { DEFAULT: "#FF5F1F", dark: "#E04A0E", light: "#FF8350" },
        mustard: "#F4C430",
        ketchup: "#C0392B",
        bone: "#F5F2EB",
        smoke: "#A0A0A0",
      },
      fontFamily: {
        display: ['"Bebas Neue"', "Impact", "sans-serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      letterSpacing: { poster: "0.04em" },
    },
  },
  plugins: [],
};
