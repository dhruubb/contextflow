import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pino", "pino-pretty"],
  devIndicators: false,
  async redirects() {
    return [{ source: '/continuity', destination: '/performance', permanent: true }];
  },
};

export default nextConfig;
