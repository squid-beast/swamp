/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emits .next/standalone — a self-contained server.js with only the modules it
  // actually imports, so a container image is ~150MB instead of the whole
  // node_modules tree. Vercel ignores this; it only matters when self-hosting.
  output: "standalone",

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
