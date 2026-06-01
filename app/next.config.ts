import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native/Node-only packages out of the bundler so they load at runtime.
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
};

export default nextConfig;
