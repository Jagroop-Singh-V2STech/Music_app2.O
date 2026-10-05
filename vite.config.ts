import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  // The app calls VITE_JAM_SERVER_URL directly (localhost:8787 in dev, Render in production).
  // Only when it's unset do dev/preview fall back to proxying /api/jam to a local Jam server; production builds never use this.
  const proxy = env.VITE_JAM_SERVER_URL ? undefined : { "/api/jam": { target: env.JAM_SERVER_PROXY || "http://localhost:8787", ws: true } };
  return {
    plugins: [react()],
    server: { proxy },
    preview: { proxy }
  };
});
