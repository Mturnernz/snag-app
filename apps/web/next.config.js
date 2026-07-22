/** @type {import('next').NextConfig} */
const nextConfig = {
  // packages/* are TS source with no build step — Next needs to compile them
  // itself rather than treating them as pre-built external node_modules.
  transpilePackages: ['@snag/shared-types', '@snag/supabase-queries'],
};

module.exports = nextConfig;
