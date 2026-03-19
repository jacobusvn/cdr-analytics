import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow embedding in iframe only from GHL and your own domains
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

export default nextConfig;
