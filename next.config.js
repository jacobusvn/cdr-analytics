/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Prevent webpack from bundling these - load from node_modules at runtime
    serverComponentsExternalPackages: ["bcryptjs", "jsonwebtoken"],
  },
  async headers() {
    const allowedOrigins = process.env.ALLOWED_FRAME_ORIGINS || "'self'";
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${allowedOrigins}`,
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
