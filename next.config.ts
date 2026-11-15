import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // the dev badge sits over the side menu's bottom block
  devIndicators: false,
  experimental: {
    // CSV import sends the file text (up to 10 MB, docs/01 FR-6) to a server action.
    serverActions: { bodySizeLimit: '11mb' },
  },
  poweredByHeader: false,
  async headers() {
    return [
      // every response: no framing by other sites (the file preview frames our own route, so 'self'), no MIME
      // sniffing, no full URLs (org slugs, sheet and item ids) as a referrer to other sites
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
          },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      // public forms (docs/05 §3.3): never indexed, and the link (the form's only key) never leaks as a referrer.
      // After the rule above, so its Referrer-Policy wins.
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
