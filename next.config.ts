import type { NextConfig } from "next";
const config: NextConfig = {
  trailingSlash: true,
  poweredByHeader: false,
  transpilePackages: ["@policyengine/microcosm-provider-orrery"],
  // Draft Git source ships TypeScript with ESM .js specifiers. Remove this
  // override when switching to the registry package's compiled JavaScript.
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".js"],
    };
    return config;
  },
};
export default config;
