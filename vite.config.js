const path = require('path');
const { defineConfig } = require('vite');

const projectDir = __dirname;

module.exports = defineConfig({
  root: path.resolve(projectDir, 'src'),
  base: './',
  build: {
    outDir: path.resolve(projectDir, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: { main: path.resolve(projectDir, 'src/index.html') }
    }
  },
  server: { port: 5173, strictPort: true }
});
