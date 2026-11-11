import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // the dev badge sits over the side menu's bottom block
  devIndicators: false,
  experimental: {
    // CSV import sends the file text (up to 10 MB, docs/01 FR-6) to a server action.
    serverActions: { bodySizeLimit: '11mb' },
  },
};

export default nextConfig;
