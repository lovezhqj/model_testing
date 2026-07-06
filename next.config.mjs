/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/assets/:path*',
        destination: '/api/proxy/assets/:path*',
      },
      {
        source: '/static/:path*',
        destination: '/api/proxy/static/:path*',
      },
      {
        source: '/api/:path((?!models|cron|auth|proxy).*)',
        destination: '/api/proxy/api/:path',
      },
    ];
  },
};

export default nextConfig;
