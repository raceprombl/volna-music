import { defineConfig } from "vite";

export default defineConfig({
  server: {
    // Downloads can be locked briefly by Chrome/Defender on Windows.
    // Generated files are not source and must never be watched by Vite.
    watch: {
      ignored: [
        "**/artifacts/**",
        "**/.tools/**",
        "**/graphify-out/**",
        "**/dist/**",
      ],
    },
  },
});
