import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`        -> dist/        (GitHub / kendi domain'in için statik dosyalar)
// `npm run build:single` -> dist-single/ (internet olmadan çift tıklayıp açılan tek HTML)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 1500,
  },
}));
