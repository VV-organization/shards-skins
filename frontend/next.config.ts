import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    const backend = process.env.SHARDS_BACKEND_ORIGIN ?? "http://127.0.0.1:5199";
    return [{source:"/api/:path*",destination:`${backend.replace(/\/$/, "")}/:path*`}];
  },
  ...(process.env.NEXT_PUBLIC_STATIC_EXPORT === "true" ? {output: "export" as const, trailingSlash: true} : {}),
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  turbopack: { root: process.cwd() },
  images: { unoptimized: true },
  devIndicators: false,
};
export default config;
