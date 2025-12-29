import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    publicDir: resolve('public'),
    resolve: {
      alias: {
        '~': resolve('src'),
      },
    },
  },
  preload: {
    publicDir: resolve('public'),
    resolve: {
      alias: {
        '~': resolve('src'),
      },
    },
  },
  renderer: {
    publicDir: resolve('public'),
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '~': resolve('src'),
      },
    },
    plugins: [tailwindcss(), react()],
  },
})
