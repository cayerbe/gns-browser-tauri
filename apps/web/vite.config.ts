import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            'libsodium-wrappers': require.resolve('libsodium-wrappers'),
        },
    },
    build: {
        outDir: 'build',
    },
    server: {
        port: 3000,
    }
});
