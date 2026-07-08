/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html.j2", "./public/js/**/*.js"],
  theme: {
    extend: {
      colors: {
        torch: {
          ink: "var(--ink)",
          muted: "var(--muted)",
          paper: "var(--paper)",
          accent: "var(--accent-solid)"
        }
      },
      borderRadius: {
        card: "8px"
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Playfair Display", "Georgia", "serif"],
        serif: ["Crimson Text", "Georgia", "serif"]
      }
    }
  }
};
