import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const turnstileSiteKey = (env.TURNSTILE_SITE_KEY || env.VITE_TURNSTILE_SITE_KEY || '').trim()

  if (mode === 'development' && !turnstileSiteKey) {
    console.error(
      '[vite.config.ts] Missing TURNSTILE_SITE_KEY environment variable. Set TURNSTILE_SITE_KEY in .env (or Vercel env) so import.meta.env.VITE_TURNSTILE_SITE_KEY is available.'
    )
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    define: {
      'import.meta.env.VITE_TURNSTILE_SITE_KEY': JSON.stringify(turnstileSiteKey),
    },
  }
})
