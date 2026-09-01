import type { NextConfig } from 'next';

const assetPrefix = process.env.STATIC_PAGES_BASE_PATH ?? '';

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  assetPrefix,
};

export default nextConfig;
