import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        home: resolve(projectRoot, 'index.html'),
        solucion: resolve(projectRoot, 'solucion.html'),
        creaWeb: resolve(projectRoot, 'crea-web.html'),
        pagos: resolve(projectRoot, 'pagos.html'),
        monitoreo: resolve(projectRoot, 'modulos', 'monitoreo.html'),
        soporte: resolve(projectRoot, 'modulos', 'soporte.html'),
        gestion: resolve(projectRoot, 'modulos', 'gestion.html'),
      },
    },
  },
});
