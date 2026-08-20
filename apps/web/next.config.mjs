/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Internal packages ship raw TypeScript and are transpiled by Next.
  transpilePackages: [
    "@particle/contracts",
    "@particle/ui-protocol",
    "@particle/morph-engine",
    "@particle/ui-registry",
    "@particle/world-model",
    "@particle/significance-engine",
    "@particle/intelligence",
    "@particle/decision-engine",
    "@particle/capability-core",
    "@particle/permission-engine",
    "@particle/runtime-core",
  ],
};

export default nextConfig;
