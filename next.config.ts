import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // @ts-expect-error - Next.js config type might be outdated
  allowedDevOrigins: ['192.168.1.92'],
};

export default nextConfig;
