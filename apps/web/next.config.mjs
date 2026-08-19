/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Internal packages ship raw TypeScript and are transpiled by Next.
  transpilePackages: [
    "@dm/contracts",
    "@dm/ui-protocol",
    "@dm/morph-engine",
    "@dm/ui-registry",
  ],
};

export default nextConfig;
