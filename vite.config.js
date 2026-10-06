import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { proxy: { '/api': 'http://127.0.0.1:3001' } }, build: { outDir: 'dist', rollupOptions:{output:{manualChunks(id){if(id.includes('node_modules/react')||id.includes('node_modules/scheduler'))return 'react';if(id.includes('node_modules/motion')||id.includes('node_modules/framer-motion'))return 'motion';}}} } });
