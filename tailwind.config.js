/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Paleta de la web de Lalo's: crema, papel, azul y naranja
      colors: {
        crema: "#F2EFE6",
        papel: "#FBF9F3",
        azul: { DEFAULT: "#1B3F94", d: "#11295F" },
        naranja: { DEFAULT: "#EE7623", d: "#C95A0E" },
        ink: { DEFAULT: "#152655", 2: "#3A4670" },
        ketchup: "#C0392B",
        // Nombres que usan los componentes, con los colores nuevos
        carbon: "#F2EFE6",
        asphalt: { DEFAULT: "#FBF9F3", light: "#E9E4D3", lighter: "#DDD6C1" },
        flame: { DEFAULT: "#EE7623", dark: "#C95A0E", light: "#F59A55" },
        mustard: "#C95A0E",
        bone: "#152655",
        smoke: "#3A4670",
      },
      fontFamily: {
        display: ['"Anton"', "Impact", "sans-serif"],
        sans: ["Poppins", "system-ui", "sans-serif"],
      },
      letterSpacing: { poster: "0.04em" },
    },
  },
  plugins: [],
};
