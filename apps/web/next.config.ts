import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/** The only third-party origin the browser may talk to: our Supabase project. */
function supabaseOrigins(): string[] {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return [];
  try {
    const { host } = new URL(url);
    return [`https://${host}`, `wss://${host}`];
  } catch {
    return [];
  }
}

/**
 * Content Security Policy. Scripts and styles may only come from this site
 * ('unsafe-inline' is required by Next's inline bootstrap scripts and the
 * theme script; 'unsafe-eval' only in dev for fast refresh). No plugins, no
 * framing, and forms can only post back to us.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // Company logos come from many job-board CDNs.
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  `connect-src 'self' ${supabaseOrigins().join(" ")}${isDev ? " ws:" : ""}`.trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Two years, all subdomains; browsers ignore it on plain-http localhost.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep the dev badge clear of the mobile tab bar.
  devIndicators: { position: "top-right" },
  // The shared package ships TypeScript source; Next compiles it with the app.
  transpilePackages: ["@orbit/core"],
  // A second dev server (preview mode) can use its own build folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Server Actions only accept same-origin calls (Next's default); cap body size.
  experimental: { serverActions: { bodySizeLimit: "1mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
