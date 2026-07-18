import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    name: "ui",
    include: ["test/ui/**/*.test.tsx"],
    environment: "jsdom",
    setupFiles: ["./test/ui/setup.ts"],
  },
});
