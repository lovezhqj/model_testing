/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return {
      // fallback: only runs if no filesystem route matched.
      // Our own routes (/api/auth, /api/models, /api/cron/fetch, /api/proxy/[...path],
      // /, /auth) are all filesystem routes and match first.
      // Everything else (SPA routes like /login, /console, third-party API calls like
      // /api/user/login, /api/channel/, and static assets like /assets/*) falls through
      // to the proxy.
      fallback: [
        {
          source: '/:path*',
          destination: '/api/proxy/:path*',
        },
      ],
    };
  },
};

export default nextConfig;
