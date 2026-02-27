import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.ANTHROPIC_API_KEY': JSON.stringify(env.ANTHROPIC_API_KEY),
      'process.env.ANTHROPIC_BASE_URL': JSON.stringify(env.ANTHROPIC_BASE_URL),
      'process.env.SILICONFLOW_API_KEY': JSON.stringify(env.SILICONFLOW_API_KEY),
      'process.env.SILICONFLOW_BASE_URL': JSON.stringify(env.SILICONFLOW_BASE_URL),
      'process.env.DEEPSEEK_MODEL': JSON.stringify(env.DEEPSEEK_MODEL),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR can be disabled via DISABLE_HMR env var in constrained environments.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
