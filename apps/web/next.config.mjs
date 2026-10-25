/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // @einkaufszettel/core wird nach dist/ kompiliert (siehe tsconfig.build.json).
  // transpilePackages bündelt die ESM-Artefakte sauber in die Next-App.
  transpilePackages: ['@einkaufszettel/core'],
};

export default nextConfig;
