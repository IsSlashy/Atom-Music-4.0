import { readFileSync } from 'node:fs';
import { basename, relative, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';
import { Node, Project, ts } from 'ts-morph';

import pluginLoader from './plugin-loader.mjs';

import { Platform } from '../src/types/plugins';

import type { Plugin } from 'vite';

const kebabToCamel = (text: string) =>
  text.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase());

const __dirname = dirname(fileURLToPath(import.meta.url));
const globalProject = new Project({
  tsConfigFilePath: resolve(__dirname, '..', 'tsconfig.json'),
  skipAddingFilesFromTsConfig: true,
  skipLoadingLibFiles: true,
  skipFileDependencyResolution: true,
});

// In main, a plugin's stub (name, config, menu...) comes from this module
// instead of the plugin's index, which imports the code of every context.
// Listing all plugins then loads only that, and the backend and menu code of
// a plugin is imported once it is enabled.
const STUB_QUERY = '?plugin-stub';

// The top-level fields of the object a plugin passes to createPlugin(), or
// null when its index does not have that shape (it is then imported whole).
const getPluginFields = (path: string): Set<string> | null => {
  const src = globalProject.createSourceFile(
    '_pi' + basename(path),
    readFileSync(path, 'utf8'),
    { overwrite: true },
  );
  const expression = src
    .getExportAssignment((ea) => !ea.isExportEquals())
    ?.getExpression();
  const call = expression?.asKind(ts.SyntaxKind.CallExpression);
  const definition =
    call && call.getExpression().getText() === 'createPlugin'
      ? call.getArguments()[0]
      : expression;
  const object = definition?.asKind(ts.SyntaxKind.ObjectLiteralExpression);
  if (!object) return null;

  const fields = new Set<string>();
  for (const property of object.getProperties()) {
    if (
      Node.isPropertyAssignment(property) ||
      Node.isShorthandPropertyAssignment(property) ||
      Node.isMethodDeclaration(property)
    ) {
      fields.add(property.getName());
    }
  }
  return fields;
};

const stubLoader = pluginLoader('none') as {
  load: { handler: (id: string) => { code: string } | null };
};

// Serves `<plugin index>?plugin-stub`: the index without its backend,
// preload, renderer and menu, and without the imports only they used.
export const pluginStubLoader = (): Plugin => ({
  name: 'ytm-plugin-stub-loader',
  load: {
    filter: { id: /\?plugin-stub$/ },
    handler(id) {
      const path = id.slice(0, -STUB_QUERY.length);
      const stub = stubLoader.load.handler(path);
      if (!stub) throw new Error(`No createPlugin() definition in ${path}`);

      // TypeScript drops the imports the removed fields were the only users of
      const { outputText } = ts.transpileModule(stub.code, {
        fileName: basename(path),
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ESNext,
          jsx: ts.JsxEmit.Preserve,
        },
      });
      return { code: outputText, moduleType: 'js' };
    },
  },
});

export const pluginVirtualModuleGenerator = (
  mode: 'main' | 'preload' | 'renderer',
) => {
  const srcPath = resolve(__dirname, '..', 'src');
  const plugins = globSync([
    'src/plugins/*/index.{js,ts,jsx,tsx}',
    'src/plugins/*.{js,ts,jsx,tsx}',
    '!src/plugins/utils/**/*',
    '!src/plugins/utils/*',
  ]).map((path) => {
    let name = basename(path);
    if (
      name === 'index.ts' ||
      name === 'index.js' ||
      name === 'index.jsx' ||
      name === 'index.tsx'
    ) {
      name = basename(resolve(path, '..'));
    }

    name = name.replace(extname(name), '');

    return { name, path };
  });

  // Plugins with a backend, for mainPlugins()
  const mainEntries: { name: string; lazy: boolean }[] = [];

  const src = globalProject.createSourceFile(
    'vm:pluginIndexes',
    (writer) => {
      for (const { name, path } of plugins) {
        const relativePath = relative(resolve(srcPath, '..'), path).replace(
          /\\/g,
          '/',
        );
        if (mode === 'main') {
          // dynamic import (for main)
          const id = kebabToCamel(name);
          const fields = getPluginFields(path);
          writer.writeLine(
            `const ${id}PluginImport = () => import('./${relativePath}');`,
          );
          writer.writeLine(
            `const ${id}Plugin = async () => (await ${id}PluginImport()).default;`,
          );
          if (fields) {
            // Menus are built for enabled plugins only, which load the plugin
            const stub = fields.has('menu')
              ? `{ ...pluginStub, menu: async (ctx) => (await ${id}Plugin()).menu(ctx) }`
              : 'pluginStub';
            writer.writeLine(
              `const ${id}PluginStub = async () => { const { pluginStub } = await import('./${relativePath}${STUB_QUERY}'); return ${stub}; };`,
            );
            if (fields.has('backend')) mainEntries.push({ name, lazy: true });
          } else {
            writer.writeLine(
              `const ${id}PluginStub = async () => (await ${id}PluginImport()).pluginStub;`,
            );
            mainEntries.push({ name, lazy: false });
          }
        } else {
          // static import (preload does not support dynamic import)
          writer.writeLine(
            `import ${kebabToCamel(name)}PluginImport, { pluginStub as ${kebabToCamel(name)}PluginStubImport } from "./${relativePath}";`,
          );
          writer.writeLine(
            `const ${kebabToCamel(name)}Plugin = () => Promise.resolve(${kebabToCamel(name)}PluginImport);`,
          );
          writer.writeLine(
            `const ${kebabToCamel(name)}PluginStub = () => Promise.resolve(${kebabToCamel(name)}PluginStubImport);`,
          );
        }
      }

      writer.blankLine();
      if (mode === 'main' || mode === 'preload') {
        writer.writeLine("import * as is from 'electron-is';");
        writer.writeLine('globalThis.electronIs = is;');
      }
      writer.write(supportsPlatform.toString());
      writer.blankLine();

      if (mode === 'main') {
        // A disabled plugin is listed with its stub. Each call reads the
        // config, so a plugin enabled later is imported then.
        writer.writeLine("import { isEnabled } from '@/config/plugins';");
        writer.writeLine('const mainEntry = async (stubs, name, load) => {');
        writer.writeLine('  if (!stubs[name]) return null;');
        writer.writeLine(
          '  return [name, (await isEnabled(name)) ? await load() : stubs[name]];',
        );
        writer.writeLine('};');
        writer.writeLine('export const mainPlugins = async () => {');
        writer.writeLine('  const stubs = await allPlugins();');
        writer.writeLine('  const pluginEntries = await Promise.all([');
        for (const { name, lazy } of mainEntries) {
          const id = kebabToCamel(name);
          writer.writeLine(
            lazy
              ? `    mainEntry(stubs, "${name}", ${id}Plugin),`
              : `    ${id}Plugin().then((plg) => plg['backend'] ? ["${name}", plg] : null),`,
          );
        }
        writer.writeLine('  ]);');
        writer.writeLine(
          '  return pluginEntries.filter((entry) => entry && supportsPlatform(entry[1])).reduce((acc, [name, plg]) => { acc[name] = plg; return acc; }, {});',
        );
        writer.writeLine('};');
        writer.blankLine();
      } else {
        // Context-specific exports
        writer.writeLine(`let ${mode}PluginsCache = null;`);
        writer.writeLine(`export const ${mode}Plugins = async () => {`);
        writer.writeLine(
          `  if (${mode}PluginsCache) return await ${mode}PluginsCache;`,
        );
        writer.writeLine(
          '  const { promise, resolve } = Promise.withResolvers();',
        );
        writer.writeLine('  ' + `${mode}PluginsCache = promise;`);
        writer.writeLine('  const pluginEntries = await Promise.all([');
        for (const { name } of plugins) {
          // HACK: To avoid situation like importing renderer plugins in main
          writer.writeLine(
            `    ${kebabToCamel(name)}Plugin().then((plg) => plg['${mode}'] ? ["${name}", plg] : null),`,
          );
        }
        writer.writeLine('  ]);');
        writer.writeLine(
          '  resolve(pluginEntries.filter((entry) => entry && supportsPlatform(entry[1])).reduce((acc, [name, plg]) => { acc[name] = plg; return acc; }, {}));',
        );
        writer.writeLine(`  return await ${mode}PluginsCache;`);
        writer.writeLine('};');
        writer.blankLine();
      }

      // All plugins export (stub only) // Omit<Plugin, 'backend' | 'preload' | 'renderer'>
      writer.writeLine('let allPluginsCache = null;');
      writer.writeLine('export const allPlugins = async () => {');
      writer.writeLine('  if (allPluginsCache) return await allPluginsCache;');
      writer.writeLine(
        '  const { promise, resolve } = Promise.withResolvers();',
      );
      writer.writeLine('  allPluginsCache = promise;');
      writer.writeLine('  const stubEntries = await Promise.all([');
      for (const { name } of plugins) {
        writer.writeLine(
          `    ${kebabToCamel(name)}PluginStub().then((stub) => ["${name}", stub]),`,
        );
      }
      writer.writeLine('  ]);');
      writer.writeLine(
        '  resolve(stubEntries.filter(entry => entry && supportsPlatform(entry[1])).reduce((acc, [name, plg]) => { acc[name] = plg; return acc; }, {}));',
      );
      writer.writeLine('  return await promise;');
      writer.writeLine('};');
      writer.blankLine();
    },
    { overwrite: true },
  );

  return src.getText();
};

function supportsPlatform({ platform }: { platform: string }) {
  if (typeof platform !== 'number') return true;

  const is = globalThis.electronIs;

  if (is.windows()) return (platform & Platform.Windows) !== 0;
  if (is.macOS()) return (platform & Platform.macOS) !== 0;
  if (is.linux()) return (platform & Platform.Linux) !== 0;
  if (is.freebsd()) return (platform & Platform.Freebsd) !== 0;

  // unknown platform
  return false;
}
