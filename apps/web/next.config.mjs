/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Internal packages ship raw TypeScript and are transpiled by Next.
  transpilePackages: [
    "@dm/contracts",
    "@dm/ui-protocol",
    "@dm/morph-engine",
    "@dm/ui-registry",
    "@dm/world-model",
    "@dm/significance-engine",
    "@dm/intelligence",
    "@dm/decision-engine",
    "@dm/capability-core",
    "@dm/permission-engine",
    "@dm/runtime-core",
  ],
};

export default nextConfig;
