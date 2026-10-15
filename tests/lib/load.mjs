/**
 * load.mjs — 从单文件 HTML 里取出可测试的部分。
 *
 * 两个层次的提取：
 *   1. 整个 <script> —— 交给 mock 环境真实执行
 *   2. #region CORE 区 —— 纯算法，可以在没有 DOM 的情况下单独求值
 *
 * 第 2 层是这套测试能"证明算法正确"的前提：CORE 区不允许碰 DOM，
 * 所以它可以被单独抠出来跑性质断言，不需要任何浏览器环境。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');

/** 五个游戏的清单。新增游戏只需在这里加一行。 */
export const GAMES = [
  { id: 'breakout',   title: '打砖块',   teaches: '碰撞与关卡数据' },
  { id: 'snake',      title: '贪吃蛇',   teaches: '网格逻辑与转向缓冲' },
  { id: 'platformer', title: '平台跳跃', teaches: '瓦片碰撞与手感参数' },
  { id: 'sokoban',    title: '推箱子',   teaches: '不可变状态与撤销栈' },
  { id: 'shooter',    title: '弹幕射击', teaches: '实体系统与弹幕模式' },
];

export function gamePath(id) {
  return path.join(ROOT, 'games', id + '.html');
}

/** 读出 HTML、<script>、以及 CORE 区源码 */
export function readGame(id) {
  const file = gamePath(id);
  const html = fs.readFileSync(file, 'utf8');

  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!scriptMatch) throw new Error(id + ': 找不到 <script> 块');
  const script = scriptMatch[1];

  const coreMatch = script.match(/\/\* #region CORE[\s\S]*?\/\* #endregion CORE \*\//);
  const core = coreMatch ? coreMatch[0] : null;

  return { id, file, html, script, core };
}

/**
 * 把 CORE 区单独求值成对象。
 *
 * 因为 CORE 区是不碰 DOM 的纯逻辑，这里不需要传给任何东西 ——
 * 如果它引用了 window / document，这里会直接抛 ReferenceError，
 * 那正是我们想要的信号。
 */
export function evalCore(id) {
  const { core } = readGame(id);
  if (!core) throw new Error(id + ': 没有 #region CORE 区');
  // eslint-disable-next-line no-new-func
  return new Function(core + '\nreturn CORE;')();
}

/** 启动一个游戏：mock 环境 + 执行脚本 + 取回调试接口 */
export function loadGame(id, opts = {}) {
  const { html, script, core } = readGame(id);
  const envModule = opts.env;
  if (!envModule) throw new Error('loadGame 需要传入 env（见 tests/lib/env.mjs）');
  const env = envModule.createMockEnv(opts);
  env.run(script);
  return { id, env, GAME: env.window.__GAME__, html, script, core };
}

/* ------------------------------------------------------------------ *
 * 静态检查用的提取函数
 * ------------------------------------------------------------------ */

/** HTML 里声明了哪些 id */
export function declaredIds(html) {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
}

/**
 * JS 里引用了哪些 id。
 *
 * mock DOM 会给任何 id 自动建元素，所以"引用了不存在的 id"在运行时
 * 完全测不出来 —— 只有这个静态检查能抓到。
 */
export function referencedIds(script) {
  const refs = new Set();
  for (const m of script.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) refs.add(m[1]);
  for (const m of script.matchAll(/\bel\(\s*['"]([^'"]+)['"]\s*\)/g)) refs.add(m[1]);
  for (const m of script.matchAll(/\bbyId\(\s*['"]([^'"]+)['"]\s*\)/g)) refs.add(m[1]);
  return refs;
}

/**
 * 外部资源引用。命中任何一条都说明这个文件不能离线运行 ——
 * "零依赖可离线"是这类单文件游戏的核心承诺，必须守住。
 */
export function externalRefs(html) {
  const hits = [];
  const patterns = [
    [/<script[^>]+\bsrc\s*=/gi, 'script src'],
    [/<link[^>]+\bhref\s*=\s*["']?(?!#)[^"'>]+/gi, 'link href'],
    [/\b(?:src|href)\s*=\s*["'](?:https?:)?\/\//gi, 'protocol-relative or absolute URL'],
    [/@import\s+(?:url\()?["']/gi, 'CSS @import'],
    [/\bfetch\s*\(/g, 'fetch()'],
    [/\bXMLHttpRequest\b/g, 'XMLHttpRequest'],
    [/\bimport\s*\(/g, 'dynamic import()'],
  ];
  for (const [re, label] of patterns) {
    const found = html.match(re);
    if (found) hits.push(label + ' × ' + found.length);
  }
  return hits;
}

/** 标签开闭是否配平（只查我们实际会用的那几个） */
export function tagBalance(html) {
  const out = {};
  for (const tag of ['div', 'span', 'b', 'i', 'canvas', 'style', 'script', 'p']) {
    const open = (html.match(new RegExp('<' + tag + '(?=[\\s>])', 'gi')) || []).length;
    const close = (html.match(new RegExp('</' + tag + '\\s*>', 'gi')) || []).length;
    out[tag] = { open, close, balanced: open === close };
  }
  return out;
}

/**
 * 从源码里取出 `innerHTML = [...]` 的字符串数组并拼成一段 HTML。
 *
 * mock 不解析 innerHTML，所以"写在字符串里的界面"完全测不到 ——
 * 标签漏闭合、id 拼错、类名与 CSS 不一致，都要靠这个兜底。
 */
export function extractStringArray(src, decl) {
  const i = src.indexOf(decl);
  if (i < 0) return null;
  const start = src.indexOf('[', i);
  if (start < 0) return null;
  let depth = 0;
  let end = -1;
  for (let k = start; k < src.length; k++) {
    if (src[k] === '[') depth++;
    else if (src[k] === ']' && --depth === 0) { end = k; break; }
  }
  if (end < 0) return null;
  const literals = src.slice(start, end + 1).match(/'[^'\n]*'|`[^`]*`/g) || [];
  return literals.map(p => p.slice(1, -1)).join('\n');
}

/** 源码里出现过的 CSS 类名（用于和 <style> 里的定义比对） */
export function cssClasses(css) {
  return new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map(m => m[1]));
}
