import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  defineConfig,
  type MainViteConfig,
  type PreloadViteConfig,
  type RendererViteConfig,
} from 'electron-vite';
import builtinModules from 'builtin-modules';

import Inspect from 'vite-plugin-inspect';
import solidPlugin from 'vite-plugin-solid';
import viteResolve from 'vite-plugin-resolve';

import { withFilter } from 'vite';

import {
  pluginStubLoader,
  pluginVirtualModuleGenerator,
} from './vite-plugins/plugin-importer.mjs';
import pluginLoader from './vite-plugins/plugin-loader.mjs';
import { i18nImporter } from './vite-plugins/i18n-importer.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const resolveAlias = {
  '@': resolve(__dirname, './src'),
  '@assets': resolve(__dirname, './assets'),
};

// fflate's ESM build for Node declares a top-level `require`, and electron-vite
// injects its own `const require` shim into the same chunk, which then fails
// to parse. Its CommonJS build keeps that `require` inside the module wrapper.
const fflateNode = createRequire(import.meta.url).resolve('fflate');

// Vite 8 follows Node for CommonJS interop: a default import of a CommonJS
// module that sets __esModule now gets module.exports instead of its default
// export. The app's imports (enhanceWebRequest among them) expect the old way.
const legacy = { inconsistentCjsInterop: true };

export default defineConfig(({ mode }) => ({
  main: {
    legacy,
    plugins: [
      pluginLoader('backend'),
      pluginStubLoader(),
      viteResolve({
        'virtual:i18n': i18nImporter(),
        'virtual:plugins': pluginVirtualModuleGenerator('main'),
      }),
      ...(mode === 'development'
        ? [
            Inspect({
              build: true,
              outputDir: join(__dirname, '.vite-inspect/backend'),
            }),
          ]
        : []),
    ],
    publicDir: 'assets',
    define: {
      '__dirname': 'import.meta.dirname',
      '__filename': 'import.meta.filename',
    },
    build: {
      lib: {
        entry: 'src/index.ts',
        formats: ['es'],
      },
      outDir: 'dist/main',
      rolldownOptions: {
        external: [
          'electron',
          'custom-electron-prompt',
          '@jellybrick/mpris-service',
          ...builtinModules,
        ],
        input: './src/index.ts',
        output: {
          // Same as upstream, which sets this to avoid an oxc-minify bug that
          // broke the main bundle (pear-desktop 0c42c825, issue #4462)
          comments: {
            jsdoc: true,
            annotation: false,
            legal: true,
          },
        },
      },
      sourcemap: mode === 'development' ? 'inline' : false,
      minify: mode !== 'development',
      cssMinify: mode !== 'development',
      // electron-builder.yml leaves node_modules out of the app, so bundle the
      // dependencies (electron-vite 6 externalizes them by default)
      externalizeDeps: false,
    },
    resolve: {
      alias: { ...resolveAlias, fflate: fflateNode },
    },
  } satisfies MainViteConfig,
  preload: {
    legacy,
    plugins: [
      pluginLoader('preload'),
      viteResolve({
        'virtual:i18n': i18nImporter(),
        'virtual:plugins': pluginVirtualModuleGenerator('preload'),
      }),
      ...(mode === 'development'
        ? [
            Inspect({
              build: true,
              outputDir: join(__dirname, '.vite-inspect/preload'),
            }),
          ]
        : []),
    ],
    build: {
      lib: {
        entry: 'src/preload.ts',
        formats: ['cjs'],
      },
      outDir: 'dist/preload',
      commonjsOptions: {
        ignoreDynamicRequires: true,
      },
      rolldownOptions: {
        external: ['electron', 'custom-electron-prompt', ...builtinModules],
        input: './src/preload.ts',
      },
      sourcemap: mode === 'development' ? 'inline' : false,
      minify: mode !== 'development',
      cssMinify: mode !== 'development',
      externalizeDeps: false,
    },
    resolve: {
      alias: resolveAlias,
    },
  } satisfies PreloadViteConfig,
  renderer: {
    legacy,
    plugins: [
      pluginLoader('renderer'),
      viteResolve({
        'virtual:i18n': i18nImporter(),
        'virtual:plugins': pluginVirtualModuleGenerator('renderer'),
      }),
      withFilter(solidPlugin(), {
        load: { id: [/\.(tsx|jsx)$/, '/@solid-refresh'] },
      }),
      ...(mode === 'development'
        ? [
            Inspect({
              build: true,
              outputDir: join(__dirname, '.vite-inspect/renderer'),
            }),
          ]
        : []),
    ],
    root: './src/',
    build: {
      lib: {
        entry: 'src/index.html',
        formats: ['iife'],
        name: 'renderer',
      },
      outDir: 'dist/renderer',
      rolldownOptions: {
        external: ['electron', ...builtinModules],
        input: './src/index.html',
      },
      sourcemap: mode === 'development' ? 'inline' : false,
      minify: mode !== 'development',
      cssMinify: mode !== 'development',
    },
    resolve: {
      alias: resolveAlias,
    },
    server: {
      cors: {
        origin: 'https://music.youtube.com',
      },
    },
  } satisfies RendererViteConfig,
}));
