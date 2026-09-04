/** @type {import('next').NextConfig} */
const apiOrigin = (() => {
  try {
    return process.env.NEXT_PUBLIC_API_BASE ? new URL(process.env.NEXT_PUBLIC_API_BASE).origin : "";
  } catch {
    return "";
  }
})();

// Content-Security-Policy for the production build. The bearer token lives in
// localStorage, so the page's own script-src is the last line against a token
// theft: no third-party script may load, nothing may frame us, and the only
// network destinations are this origin and the API origin (when split).
// 'unsafe-inline' for scripts covers the JSON-LD block and Next's hydration
// bootstrap; a nonce would need dynamic rendering of the static pages.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${apiOrigin}`.trim(),
  `media-src 'self' blob: ${apiOrigin}`.trim(),
  `connect-src 'self' ${apiOrigin}`.trim(),
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

module.exports = {
  reactStrictMode: true,
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];   // dev needs eval/HMR
    return [{
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};
