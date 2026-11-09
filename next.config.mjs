/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Common misspelling (Indonesian "portofolio") -> the real route.
  async redirects() {
    return [{ source: "/portofolio", destination: "/portfolio", permanent: false }];
  },
};
export default nextConfig;
