import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // BullMQ 5.x dynamically imports `@valkey/valkey-glide` as an optional
  // dependency. We use plain Redis (ioredis), not Valkey/Glide, so the
  // dynamic import resolves to nothing and triggers a noisy webpack warning.
  // Aliasing the module to an empty stub silences the warning without
  // changing runtime behavior, since the import path is never reached in
  // a Redis-only setup.
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@valkey/valkey-glide$": false,
      "@": path.resolve(__dirname, "./src"),
    };
    return config;
  },
};

export default nextConfig;
