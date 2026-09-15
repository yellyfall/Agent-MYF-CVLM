import { mkdir, copyFile } from 'node:fs/promises';
import { build } from 'esbuild';
await mkdir('public/vendor', {recursive:true});
await copyFile('node_modules/pdfjs-dist/build/pdf.mjs','public/vendor/pdf.mjs');
await copyFile('node_modules/pdfjs-dist/build/pdf.worker.mjs','public/vendor/pdf.worker.mjs');
await copyFile('node_modules/mammoth/mammoth.browser.min.js','public/vendor/mammoth.js');
await build({entryPoints:['src/export.js'],bundle:true,format:'esm',outfile:'public/vendor/export.js',minify:true});
console.log('Bibliothèques locales préparées.');

