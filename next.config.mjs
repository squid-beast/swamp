/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // Canonical route migration — keep old links/bookmarks/agents working.
      { source: "/d/:id", destination: "/app/datasets/:id", permanent: true },
      { source: "/sign-in", destination: "/auth/sign-in", permanent: true },
      { source: "/register", destination: "/auth/register", permanent: true },
      { source: "/app/board", destination: "/app/tasks", permanent: true },
    ];
  },
};

export default nextConfig;
