import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The custom server (server.ts) handles WebSocket upgrades.
  // Standalone output bundles all dependencies for deployment on Render.
  output: "standalone",
};

export default nextConfig;
