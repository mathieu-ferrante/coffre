// Construit l'app dans dist/ (fichiers statiques, à héberger en HTTPS).
//   npm run build            → version de production
//   npm run dev              → serveur local http://localhost:5173 avec reconstruction auto
// Variable facultative : DROPBOX_APP_KEY=xxxx npm run build  (pré-remplit la clé Dropbox)
import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile, rm, cp, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'dist');
const serve = process.argv.includes('--serve');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const shim = join(root, 'scripts', 'empty-module.cjs');

await rm(out, { recursive: true, force: true });
await cp(join(root, 'public'), out, { recursive: true });

const options = {
  absWorkingDir: root,
  entryPoints: { app: 'src/main.ts', 'argon2-worker': 'src/argon2-worker.ts' },
  outdir: out,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome100', 'edge100', 'firefox100', 'safari15.4'],
  minify: !serve,
  sourcemap: serve ? 'inline' : false,
  legalComments: 'eof',
  logLevel: 'info',
  logOverride: { 'import-is-undefined': 'silent' },
  // kdbxweb référence les modules Node « crypto » et « @xmldom/xmldom » ;
  // dans le navigateur il utilise WebCrypto et DOMParser à la place.
  alias: { crypto: shim, '@xmldom/xmldom': shim },
  define: {
    __DEV__: String(serve),
    __APP_VERSION__: JSON.stringify(pkg.version),
    __DROPBOX_APP_KEY__: JSON.stringify(process.env.DROPBOX_APP_KEY ?? ''),
    global: 'globalThis',
  },
};

async function listFiles(dir) {
  const res = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) res.push(...(await listFiles(p)));
    else res.push(p);
  }
  return res;
}

async function writeServiceWorker() {
  const files = (await listFiles(out)).filter((f) => !f.endsWith('sw.js') && !f.endsWith('.map') && !f.endsWith('.LEGAL.txt'));
  const hash = createHash('sha256');
  const rel = [];
  for (const f of files.sort()) {
    hash.update(f);
    hash.update(await readFile(f));
    rel.push(relative(out, f).split('\\').join('/'));
  }
  const version = hash.digest('hex').slice(0, 12);
  const template = await readFile(join(root, 'src', 'sw.template.js'), 'utf8');
  const list = ['./', ...rel];
  await writeFile(join(out, 'sw.js'), template.replace('__VERSION__', version).replace('__FILES__', JSON.stringify(list, null, 2)));
  return version;
}

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: out, port: 5173, host: '127.0.0.1' });
  console.log(`\n  Coffre (développement) : http://localhost:${port}/\n`);
} else {
  await esbuild.build(options);
  const version = await writeServiceWorker();
  console.log(`Construit dans dist/ (version ${pkg.version}, cache ${version}).`);
}
