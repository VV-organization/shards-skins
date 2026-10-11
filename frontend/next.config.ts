import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  ...(process.env.NEXT_PUBLIC_STATIC_EXPORT === "true" ? {output: "export" as const, trailingSlash: true} : {}),
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  turbopack: { root: process.cwd() },
  images: { unoptimized: true },
  devIndicators: false,
};
export default config;
