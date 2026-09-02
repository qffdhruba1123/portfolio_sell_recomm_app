import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  base: '/portfolio_sell_recomm_app/',
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
  },
})
