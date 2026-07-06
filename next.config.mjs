/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return {
      // afterFiles: runs AFTER filesystem routes (our own /api/models, /api/auth, etc.)
      // so only unmatched /api/* paths hit these rewrites — no conflicts with our own routes.
      afterFiles: [
        {
          source: '/api/:path*',
          destination: '/api/proxy/api/:path*',
        },
        {
          source: '/assets/:path*',
          destination: '/api/proxy/assets/:path*',
        },
        {
          source: '/static/:path*',
          destination: '/api/proxy/static/:path*',
        },
      ],
      // fallback: runs only if no page/file AND no afterFiles rewrite matched.
      // Catches SPA client-side routes like /login, /console, /register, etc.
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
