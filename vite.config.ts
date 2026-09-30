import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// /api -> serveur IA local (npm run api)
export default defineConfig({ plugins: [react()], server: { proxy: { "/api": "http://localhost:8787" } }, build: { target: "es2020", chunkSizeWarningLimit: 900 } });
