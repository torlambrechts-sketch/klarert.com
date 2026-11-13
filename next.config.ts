import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // the dev badge sits over the side menu's bottom block
  devIndicators: false,
  experimental: {
    // CSV import sends the file text (up to 10 MB, docs/01 FR-6) to a server action.
    serverActions: { bodySizeLimit: '11mb' },
  },
  // public forms (docs/05 §3.3): never indexed, and the link (the form's only key) never leaks as a referrer
  async headers() {
    return [
      {
        source: '/f/:token*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default nextConfig;
