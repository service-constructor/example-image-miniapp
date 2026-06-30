import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The mini-app stays same-origin via proxies:
//   /service/* -> the service backend (quote, gallery)
//   /shell/*   -> the mock wallet shell (bridge handshake + pay)
// In a real deployment the mini-app is loaded inside the wallet WebView and the
// bridge talks to the shell over postMessage instead of a /shell proxy.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      "/service": {
        target: "http://localhost:4000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/service/, ""),
      },
      "/shell": {
        target: "http://localhost:4100",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/shell/, ""),
      },
    },
  },
});
