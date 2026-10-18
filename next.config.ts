import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  devIndicators: false,
  serverExternalPackages: ["@libsql/client"],
  turbopack: { root: process.cwd() },
};
export default config;
