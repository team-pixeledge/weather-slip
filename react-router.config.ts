import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";

// Vercel now, AWS later: the preset only applies on a Vercel build (VERCEL=1
// is set by its build environment). Everywhere else — local, Docker, a future
// AWS container — this is a plain Node server build (`npm start`).
export default {
  ssr: true,
  presets: process.env.VERCEL ? [vercelPreset()] : [],
} satisfies Config;
