import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// During `npm run dev`, calls to /api are proxied to the .NET API so the
// browser only ever talks to one origin (no CORS headaches).
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:5080',
                changeOrigin: true,
            },
        },
    },
    build: {
        outDir: 'dist',
    },
});
