import type { NextConfig } from 'next';

/** Browser features the app never uses, turned off for every page and for anything it frames (SA-7). */
const PERMISSIONS_POLICY = [
  'accelerometer',
  'autoplay',
  'bluetooth',
  'browsing-topics',
  'camera',
  'display-capture',
  'encrypted-media',
  'geolocation',
  'gyroscope',
  'hid',
  'idle-detection',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'screen-wake-lock',
  'serial',
  'usb',
  'xr-spatial-tracking',
]
  .map((feature) => `${feature}=()`)
  .join(', ');

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
          // SA-7: no browser feature the app does not use (it uses none of these; clipboard writes keep the default)
          { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
          // SA-7: HTTPS only, for two years. includeSubDomains covers only names under the host that sends it
          // (*.www.klarert.com), not the apex or its other subdomains (docs/09 §8). No preload: that is the apex's.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
      // file preview (docs/05 §3.4, SA-15): the bytes of a PDF or image run in an opaque origin with nothing allowed
      // to load; only our own pages may frame it. Chromium's PDF viewer still renders under this policy
      // (tests/e2e/item-files.spec.ts). The preview iframe has no sandbox attribute: Chromium will not show a PDF
      // in a sandboxed frame. After the rule above, so this policy replaces the general one here.
      {
        source: '/:org/files/:fileId/preview',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "sandbox; default-src 'none'; base-uri 'none'; frame-ancestors 'self'",
          },
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
      // the email-link page (docs/09 §12): its address carries a one-time token, so the same as public forms.
      // Its Continue form then posts with `Origin: null`; the callback checks `Sec-Fetch-Site` instead.
      {
        source: '/auth/confirm',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default nextConfig;
