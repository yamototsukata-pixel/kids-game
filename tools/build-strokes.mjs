// このスクリプトは、KanjiVG から ひらがな・カタカナの書き順データを取得し、
// js/strokes.js（文字 → 画ごとの SVG パスの配列）を生成する。
// 使い方: node tools/build-strokes.mjs
// KanjiVG: https://kanjivg.tagaini.net/ （CC BY-SA 3.0, Ulrich Apel）
import { writeFile } from "node:fs/promises";

const HIRAGANA =
  "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん";
const KATAKANA =
  "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン";

const BASE = "https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/";

async function fetchStrokes(ch) {
  const code = ch.codePointAt(0).toString(16).padStart(5, "0");
  const res = await fetch(`${BASE}${code}.svg`);
  if (!res.ok) throw new Error(`${ch} (${code}) の取得に失敗: ${res.status}`);
  const svg = await res.text();
  // KanjiVG のファイルでは、画は id="kvg:XXXXX-sN" の path 要素として書き順どおりに並ぶ。
  const paths = [...svg.matchAll(/<path[^>]*\sid="kvg:[0-9a-f]+-s(\d+)"[^>]*\sd="([^"]+)"/g)]
    .map((m) => ({ n: Number(m[1]), d: m[2] }))
    .sort((a, b) => a.n - b.n)
    .map((p) => p.d);
  if (paths.length === 0) throw new Error(`${ch} の画が見つからない`);
  return paths;
}

const out = {};
for (const ch of [...HIRAGANA, ...KATAKANA]) {
  out[ch] = await fetchStrokes(ch);
  process.stdout.write(ch);
}
const body =
  "// このファイルは tools/build-strokes.mjs が自動生成した。手で編集しないこと。\n" +
  "// 書き順データの出典: KanjiVG (https://kanjivg.tagaini.net/) / CC BY-SA 3.0 / Ulrich Apel\n" +
  "window.STROKES = " +
  JSON.stringify(out, null, 0).replace(/\],"/g, '],\n"') +
  ";\n";
await writeFile(new URL("../js/strokes.js", import.meta.url), body);
console.log(`\n${Object.keys(out).length} 文字を書き出した。`);
