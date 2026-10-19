// このスクリプトは、index.html に CSS と JS を埋めこんで、1ファイルだけで動く HTML を作る。
// 使い方: node tools/build-single.mjs [出力先]（省略時は dist/mojimoji.html）
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFile(resolve(root, p), "utf8");

let html = await read("index.html");

// 先に埋めこむファイルをすべて読みこみ、そのあと関数で置きかえる（"$" を含む中身でも壊れない）。
const files = {};
for (const [, p] of html.matchAll(/(?:href|src)="((?:css|js)\/[^"]+)"/g)) files[p] = await read(p);

html = html
  .replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, p) => `<style>\n${files[p]}</style>`)
  .replace(/<script src="([^"]+)"><\/script>/g, (_, p) => `<script>\n${files[p].replace(/<\/script/gi, "<\\/script")}</script>`);

const out = resolve(process.argv[2] || resolve(root, "dist/mojimoji.html"));
await mkdir(dirname(out), { recursive: true });
await writeFile(out, html);
console.log(`${out} を書き出した（${(Buffer.byteLength(html) / 1024).toFixed(0)} KB）。`);
