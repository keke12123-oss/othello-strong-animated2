import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // 0.0.0.0 で待ち受け
    port: 5173,
    strictPort: true,
    allowedHosts: [
      "h79rln-5173.csb.app", // CodeSandboxのあなたの環境ドメイン
      "localhost"
    ],
    hmr: {
      clientPort: 443 // HMRを443経由で
    }
  }
});
