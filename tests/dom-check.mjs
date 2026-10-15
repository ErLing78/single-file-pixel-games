/**
 * dom-check.mjs — 静态一致性检查
 *
 * 这一套不能省。mock DOM 会在 getElementById 时**自动创建任何 id**，
 * 于是"JS 引用了 HTML 里不存在的元素"这类错误在运行时完全测不出来 ——
 * 直到你在真实浏览器里打开，得到一个 `null.textContent` 崩溃。
 *
 * 同理，写在字符串里的界面（innerHTML）mock 也不解析，
 * 标签漏闭合、类名拼错都要靠这里兜底。
 *
 * 运行：node tests/dom-check.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { readGame, GAMES, ROOT, declaredIds, referencedIds, externalRefs, tagBalance } from './lib/load.mjs';
import { createReporter } from './lib/env.mjs';

const r = createReporter('dom-check —— 静态一致性');

/* ------------------------------------------------------------------ *
 * 双语字典的提取工具（「双语文本」和「界面键」两个检查组都要用）
 * ------------------------------------------------------------------ */

/** 从 `const TEXTS = {` 起，按花括号配平切出整段（含两种语言） */
function textsSource(script) {
  const i = script.indexOf('const TEXTS = {');
  if (i < 0) return null;
  let depth = 0;
  const start = script.indexOf('{', i);
  let end = -1;
  for (let k = start; k < script.length; k++) {
    if (script[k] === '{') depth++;
    else if (script[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
  }
  return end < 0 ? null : script.slice(start, end + 1);
}

/** 切出某个语言的对象体 */
function langBlock(src, lang) {
  if (!src) return null;
  const i = src.indexOf(lang + ': {');
  if (i < 0) return null;
  let depth = 0;
  const start = src.indexOf('{', i);
  let end = -1;
  for (let k = start; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
  }
  return end < 0 ? null : src.slice(start, end + 1);
}

/** 从语言块里抽出 'key': 'value' 对（值里不含单引号，可以安全匹配） */
function pairs(block) {
  const out = {};
  if (!block) return out;
  for (const m of block.matchAll(/'([\w.]+)'\s*:\s*'([^']*)'/g)) out[m[1]] = m[2];
  return out;
}

/** 模板里的占位符集合，排序后拼成字符串，便于比较 */
function placeholders(s) {
  return (s.match(/\{(\w+)\}/g) || []).sort().join(',');
}

/* ==================================================================
   1. id 一致性：JS 引用的每个 id 都必须在 HTML 里声明
   ================================================================== */
r.group('id 一致性');
{
  for (const g of GAMES) {
    const { html, script } = readGame(g.id);
    const declared = declaredIds(html);
    const referenced = referencedIds(script);

    // 拆开 HTML 与脚本：脚本里字符串拼接出的 id 不算声明
    const htmlOnly = html.slice(0, html.indexOf('<script>'));
    const declaredInMarkup = declaredIds(htmlOnly);

    const missing = [...referenced].filter(id => !declaredInMarkup.has(id));
    r.ok(missing.length === 0,
         `${g.id}: JS 引用的每个 id 都在 HTML 里声明了`,
         missing.length ? '缺失：' + missing.join(', ') : `${referenced.size} 个 id 全部对得上`);

    r.ok(referenced.size >= 5, `${g.id}: 确实引用了一批界面元素`, String(referenced.size));
  }
}

r.group('id 引用必须是字面量');
{
  /* 动态 id（getElementById(someVar)）静态检查不了 —— 那等于
     放弃了这道防线。真需要动态查找时应该显式写明并在这里豁免。 */
  for (const g of GAMES) {
    const { script } = readGame(g.id);
    const dynamic = [...script.matchAll(/getElementById\(\s*([^'")\s][^)]*)\)/g)]
      .map(m => m[1].trim());
    r.ok(dynamic.length === 0, `${g.id}: 没有动态拼接的 getElementById`,
         dynamic.length ? dynamic.join(' | ') : '');
  }
}

/* ==================================================================
   2. 标签配平
   ================================================================== */
r.group('标签配平');
{
  for (const g of GAMES) {
    const { html } = readGame(g.id);
    const bal = tagBalance(html);
    for (const [tag, info] of Object.entries(bal)) {
      if (info.open === 0 && info.close === 0) continue;
      r.ok(info.balanced, `${g.id}: <${tag}> 开闭配平`,
           info.balanced ? `${info.open} 对` : `${info.open} 开 / ${info.close} 闭`);
    }
  }
}

r.group('界面的文案键都有定义');
{
  /* 界面文本现在集中在 TEXTS 字典里（见上面的「双语文本」检查组），
     所以这里改成检查**调用点传的键确实存在**——键名打错的话，
     界面上会直接显示出键名本身（比如 "over.titel"），很难定向排查。

     提取方式：先按括号配平切出每个 showOverlay / T 调用的完整范围，
     再从里面捞出所有形如 'xxx.yyy' 的字符串。
     不能直接对整段源码用"三个参数都是字面量"的正则 ——
     有的调用点中间传的是三元表达式（"这是最好的一局" vs "再来一次？"），
     那种正则匹配不到，会把检查漏掉一大半。 */
  function callSpans(src, name) {
    const out = [];
    let from = 0;
    for (;;) {
      const i = src.indexOf(name + '(', from);
      if (i < 0) break;
      // 跳过定义处：`function name(` 后面的才是调用
      let depth = 0, k = i + name.length, end = -1;
      for (; k < src.length; k++) {
        if (src[k] === '(') depth++;
        else if (src[k] === ')') { depth--; if (depth === 0) { end = k; break; } }
      }
      if (end < 0) break;
      out.push(src.slice(i, end + 1));
      from = end + 1;
    }
    return out;
  }

  for (const g of GAMES) {
    const { script } = readGame(g.id);
    const src = textsSource(script);
    if (!src) { r.ok(false, `${g.id}: 找得到 TEXTS 字典`); continue; }
    const known = new Set(Object.keys(pairs(langBlock(src, 'zh'))));

    const usedKeys = new Set();
    for (const span of callSpans(script, 'showOverlay')) {
      for (const m of span.matchAll(/'([a-z][\w]*\.[\w.]+)'/g)) usedKeys.add(m[1]);
    }
    /* 注意传的是 'T' 而不是 'T(' —— callSpans 内部会自己补 '('，
       传 'T(' 的话它会去找 'T((' 从而整体错位，一个都匹配不到。 */
    for (const span of callSpans(script, 'T')) {
      for (const m of span.matchAll(/^T\('([\w.]+)'/g)) usedKeys.add(m[1]);
    }

    /* 分开处理两种键：
       · 静态键（'over.title'）→ 必须精确存在
       · 动态前缀（T('level.' + i)）→ 必须存在同前缀的键。这样前缀打错
         （写成 'levle.'）照样会红，但不会把合法写法误报成未知键。 */
    const dynamic = [];
    const unknown = [];
    for (const k of usedKeys) {
      if (k.endsWith('.')) {
        dynamic.push(k);
        if (![...known].some(knownKey => knownKey.startsWith(k))) unknown.push(k + '*');
      } else if (!known.has(k)) {
        unknown.push(k);
      }
    }

    r.ok(unknown.length === 0, `${g.id}: 界面用到的每个文案键都在字典里`,
         unknown.length
           ? '未知键：' + unknown.join(', ')
           : `${usedKeys.size} 个键全部有定义` + (dynamic.length ? `（含 ${dynamic.length} 个动态前缀）` : ''));
    r.ok(usedKeys.size >= 5, `${g.id}: 确实检查到了一批文案键`, String(usedKeys.size));
    r.ok(dynamic.length <= 2, `${g.id}: 动态键不超过 2 处（否则检查形同虚设）`,
         dynamic.join(', ') || '无');
  }
}

r.group('运行时类名必须在 CSS 里有定义');
{
  for (const g of GAMES) {
    const { html, script } = readGame(g.id);
    const styleEnd = html.indexOf('</style>');
    const css = html.slice(0, styleEnd);
    const defined = new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map(m => m[1]));

    // 从脚本里找出 class="xxx" 这类写法
    const used = new Set();
    for (const m of script.matchAll(/class=['"]([^'"]+)['"]/g)) {
      m[1].split(/\s+/).forEach(c => c && used.add(c));
    }
    const missing = [...used].filter(c => !defined.has(c));
    r.ok(missing.length === 0, `${g.id}: 用到的类名都有样式定义`,
         missing.length ? '未定义：' + missing.join(', ') : `${used.size} 个类名`);
  }
}

/* ==================================================================
   3. 离线可运行
   ================================================================== */
r.group('零外部依赖（离线可用）');
{
  for (const g of GAMES) {
    const { html } = readGame(g.id);
    const hits = externalRefs(html);
    r.ok(hits.length === 0, `${g.id}: 没有任何外部资源引用`,
         hits.length ? hits.join(' ; ') : '无 script src / link / fetch / import');
  }

  // 整个仓库也不该有构建产物或依赖清单
  const junk = [];
  for (const dir of ['games', 'tests', 'docs', '']) {
    const p = path.join(ROOT, dir);
    if (!fs.existsSync(p)) continue;
    for (const name of fs.readdirSync(p)) {
      if (['node_modules', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'].includes(name)) {
        junk.push(path.join(dir, name));
      }
    }
  }
  r.ok(junk.length === 0, '仓库里没有 node_modules 或锁文件（零依赖的证明）',
       junk.join(', '));
}

/* ==================================================================
   4. 文件结构
   ================================================================== */
r.group('文件结构与必需文件');
{
  const required = [
    'index.html',
    'README.md',
    'LICENSE',
    'package.json',
    'docs/ANATOMY.md',
    'docs/MODDING.md',
    'docs/PATTERNS.md',
    'docs/PATTERNS.en.md',
    'tests/core.test.mjs',
    'tests/smoke.test.mjs',
    'tests/systems.test.mjs',
    'tests/dom-check.mjs',
    'tests/readme.test.mjs',
  ];
  for (const f of required) {
    r.ok(fs.existsSync(path.join(ROOT, f)), `存在 ${f}`);
  }

  for (const g of GAMES) {
    const p = path.join(ROOT, 'games', g.id + '.html');
    r.ok(fs.existsSync(p), `存在 games/${g.id}.html`);
    // 每个游戏都必须是单文件、自包含
    const size = fs.statSync(p).size;
    r.ok(size > 4000, `games/${g.id}.html 不是空壳`, (size / 1024).toFixed(1) + ' KB');
  }

  // 每个游戏都必须暴露调试接口
  for (const g of GAMES) {
    const { script } = readGame(g.id);
    r.ok(/window\.__GAME__\s*=/.test(script), `${g.id}: 暴露 window.__GAME__`);
    r.ok(/#region CORE/.test(script) && /#endregion CORE/.test(script),
         `${g.id}: 有 #region CORE 标记（算法与渲染分离）`);
  }
}

/* ==================================================================
   5. HTML 骨架
   ================================================================== */
r.group('HTML 骨架');
{
  for (const g of GAMES) {
    const { html } = readGame(g.id);
    r.ok(/^<!DOCTYPE html>/i.test(html.trim()), `${g.id}: 有 DOCTYPE`);
    r.ok(/<html lang="zh-CN">/.test(html), `${g.id}: 声明语言为 zh-CN`);
    r.ok(/<meta name="viewport"/.test(html), `${g.id}: 有 viewport（移动端可玩）`);
    r.ok(/<canvas id="world"/.test(html), `${g.id}: 有 id="world" 的 canvas`);
    r.ok(/<div id="ui">/.test(html), `${g.id}: 有独立的 UI 层`);
    r.ok(/<title>/.test(html), `${g.id}: 有标题`);
    r.ok(/pointer-events:none/.test(html), `${g.id}: UI 层默认不拦截指针事件`);
  }
}

r.group('canvas 尺寸与游戏内常量一致');
{
  for (const g of GAMES) {
    const { html, script } = readGame(g.id);
    const m = html.match(/<canvas id="world" width="(\d+)" height="(\d+)"/);
    if (!m) { r.ok(false, `${g.id}: canvas 尺寸可解析`); continue; }
    const cw = Number(m[1]), ch = Number(m[2]);
    r.ok(cw === 640 && ch === 360, `${g.id}: canvas 是 640×360`, `${cw}×${ch}`);
    // 脚本里的 W / H 常量要和 canvas 属性一致，否则画面会被拉伸
    const wm = script.match(/const W = (\d+), H = (\d+);/);
    r.ok(wm && Number(wm[1]) === cw && Number(wm[2]) === ch,
         `${g.id}: 脚本里的 W/H 与 canvas 属性一致`,
         wm ? `${wm[1]}×${wm[2]}` : '没找到 W/H 定义');
  }
}

/* ==================================================================
   5b. 双语：键必须完全对齐，标签必须配平
   ================================================================== */
r.group('双语文本');
{
  for (const g of GAMES) {
    const { script } = readGame(g.id);
    const src = textsSource(script);
    if (!src) { r.ok(false, `${g.id}: 找得到 TEXTS 字典`); continue; }

    const zh = langBlock(src, 'zh');
    const en = langBlock(src, 'en');
    r.ok(!!zh && !!en, `${g.id}: 两种语言都有文本表`);

    if (!zh || !en) continue;
    const zhPairs = pairs(zh);
    const enPairs = pairs(en);
    const zhKeys = Object.keys(zhPairs);
    const enKeys = Object.keys(enPairs);

    /* 这条断言的价值最高：翻译漏掉一条、或者键名打错一个字母，
       在浏览器里的表现是"某处突然显示成键名或旧语言"，
       很难定向排查。键对齐检查能直接指出是哪一条。 */
    const missingInEn = zhKeys.filter(k => !(k in enPairs));
    const missingInZh = enKeys.filter(k => !(k in zhPairs));
    r.ok(missingInEn.length === 0, `${g.id}: 英文表没有漏掉任何键`,
         missingInEn.length ? '缺：' + missingInEn.join(', ') : `${zhKeys.length} 个键齐全`);
    r.ok(missingInZh.length === 0, `${g.id}: 中文表没有多余的键`,
         missingInZh.length ? '多：' + missingInZh.join(', ') : '');

    // 占位符也要一致，否则某一种语言会漏掉一个数值
    const placeholderMismatch = [];
    for (const k of zhKeys) {
      if (!(k in enPairs)) continue;
      if (placeholders(zhPairs[k]) !== placeholders(enPairs[k])) {
        placeholderMismatch.push(`${k} [${placeholders(zhPairs[k])}] vs [${placeholders(enPairs[k])}]`);
      }
    }
    r.ok(placeholderMismatch.length === 0, `${g.id}: 两种语言的占位符一一对应`,
         placeholderMismatch.join(' | '));

    // 值里如果写了 HTML，标签必须配平
    const unbalance = [];
    for (const [lang, table] of [['zh', zhPairs], ['en', enPairs]]) {
      for (const [k, v] of Object.entries(table)) {
        for (const tag of ['div', 'span', 'b', 'i']) {
          const open = (v.match(new RegExp('<' + tag + '(?=[\\s>])', 'gi')) || []).length;
          const close = (v.match(new RegExp('</' + tag + '\\s*>', 'gi')) || []).length;
          if (open !== close) unbalance.push(`${lang}.${k} <${tag}> ${open}/${close}`);
        }
      }
    }
    r.ok(unbalance.length === 0, `${g.id}: 文本模板里的标签都配平`,
         unbalance.join(' | '));

    // 不能有空字符串 —— 空值在界面上就是"什么都不显示"
    const empties = zhKeys.filter(k => !zhPairs[k].trim() || !enPairs[k] || !enPairs[k].trim());
    r.ok(empties.length === 0, `${g.id}: 没有空文本`,
         empties.join(', '));

    r.note(`${g.id}: zh ${zhKeys.length} 条 / en ${enKeys.length} 条`);

    // 调试接口要暴露语言相关的方法
    for (const fn of ['lang', 'setLang', 't', 'textKeys']) {
      r.ok(new RegExp('\\b' + fn + '\\s*:').test(script) || new RegExp('\\b' + fn + '\\s*\\(').test(script),
           `${g.id}: 调试接口暴露了 ${fn}`);
    }
  }

  // 自检：键对齐检查真的能抓到漏译
  const fakeZh = "{ 'a': 'A', 'b': 'B', 'c': 'C' }";
  const fakeEn = "{ 'a': 'A', 'b': 'B' }";
  const miss = Object.keys(pairs(fakeZh)).filter(k => !(k in pairs(fakeEn)));
  r.ok(miss.length === 1 && miss[0] === 'c',
       '自检：漏译的键能被抓出来', JSON.stringify(miss));

  const fakePh1 = "{ 'x': '得分 {score}', 'y': '第 {n} 关' }";
  const fakePh2 = "{ 'x': 'Score {score}', 'y': 'Level' }";
  const p1 = pairs(fakePh1), p2 = pairs(fakePh2);
  const bad = Object.keys(p1).filter(k => placeholders(p1[k]) !== placeholders(p2[k]));
  r.ok(bad.length === 1 && bad[0] === 'y',
       '自检：占位符不一致能被抓出来', JSON.stringify(bad));
}

/* ==================================================================
   6. 代码卫生
   ================================================================== */
r.group('代码卫生');
{
  for (const g of GAMES) {
    const { script } = readGame(g.id);

    const todos = script.match(/\b(TODO|FIXME|XXX|HACK)\b/g) || [];
    r.ok(todos.length === 0, `${g.id}: 没有遗留的 TODO/FIXME`,
         todos.join(', '));

    // 调试用的 console 输出不应该留在交付代码里
    const logs = script.match(/console\.(log|debug|warn|error)\s*\(/g) || [];
    r.ok(logs.length === 0, `${g.id}: 没有遗留的 console 输出`,
         logs.join(', '));

    // 不允许再出现"下越界当作实心"这类会在关卡底部铺隐形地板的写法
    r.ok(!/r >= level\.rows\) return SOLID/.test(script),
         `${g.id}: 关卡底部没有隐形地板`);

    // 音效必须能静默降级
    if (/AudioContext/.test(script)) {
      r.ok(/typeof AudioContext === 'undefined'/.test(script) ||
           /try\s*\{[\s\S]{0,400}AudioContext/.test(script),
           `${g.id}: 音频不可用时会静默降级而不是崩溃`);
    }
  }
}

/* ==================================================================
   7. index.html 落地页
   ================================================================== */
r.group('落地页');
{
  const p = path.join(ROOT, 'index.html');
  if (!fs.existsSync(p)) {
    r.ok(false, 'index.html 存在');
  } else {
    const html = fs.readFileSync(p, 'utf8');
    for (const g of GAMES) {
      r.ok(html.includes('games/' + g.id + '.html'),
           `index.html 链接到 ${g.id}`);
    }
    r.ok(/<\/html>\s*$/.test(html.trim()), 'index.html 结构完整');
    const hits = externalRefs(html);
    r.ok(hits.length === 0, 'index.html 也没有外部依赖', hits.join('; '));
  }
}

/* ==================================================================
   8. 反向验证：静态检查真的能抓到问题
   ================================================================== */
r.group('自检：静态检查本身有效吗');
{
  /* 一个永远通过的检查等于没写。这里用合成样本验证
     "id 引用缺失"和"标签不配平"确实会被抓出来。 */
  const fakeHtml = '<div id="a"></div><span id="b"></span>';
  const fakeScript = "document.getElementById('a'); document.getElementById('c');";
  const declared = declaredIds(fakeHtml);
  const referenced = referencedIds(fakeScript);
  const missing = [...referenced].filter(id => !declared.has(id));
  r.ok(missing.length === 1 && missing[0] === 'c',
       '合成样本：引用未声明的 id 能被抓出来', JSON.stringify(missing));

  const unbalanced = '<div><span></div>';
  const bal = tagBalance(unbalanced);
  r.ok(!bal.span.balanced, '合成样本：未闭合的 <span> 能被抓出来',
       JSON.stringify(bal.span));

  const withCdn = '<script src="https://cdn.example.com/x.js"></script>';
  r.ok(externalRefs(withCdn).length > 0, '合成样本：CDN 引用能被抓出来',
       externalRefs(withCdn).join('; '));

  const offlineOk = '<script>var a=1;</script>';
  r.ok(externalRefs(offlineOk).length === 0, '合成样本：纯内联脚本不误报');
}

/* ==================================================================
   7. 隐私与凭据
   ================================================================== */
r.group('没有不该公开的东西');
{
  /* 这类项目很容易在"贴一段真实运行结果"时把本机信息带出去：
     绝对路径、主机名、SID。下面这几条是最常见的形态。 */
  const FORBIDDEN = [
    ['本机用户名路径', /[A-Za-z]:\\Users\\(?!<)[A-Za-z0-9._-]{2,}/],
    ['8.3 短名', /\b[A-Z]{3,}~\d\.[A-Z]{0,3}\b/],
    ['Windows 账号 SID', /\bS-1-5-\d{2}(?:-\d+){2,}\b/],
    ['主机名形态', /\bLAPTOP-[A-Z0-9]{6,}\b/i],
    ['邮箱地址', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
    ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/],
    ['OpenAI 风格密钥', /\bsk-[A-Za-z0-9]{20,}/],
    ['私钥块', /BEGIN [A-Z ]*PRIVATE KEY/],
    ['密码赋值', /pass(?:word|wd)\s*[:=]\s*\S/i],
  ];

  // 白名单：正当内容，不算泄漏
  const ALLOWED = [
    /github\.com\/ErLing78/,          // 作者本人的公开仓库地址
    /@qq\.com/,                       // 作者登记在仓库元数据里的邮箱
    /<YOUR NAME>/,
  ];
  const allowed = (line) => ALLOWED.some(re => re.test(line));

  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (['node_modules', '.git', '__pycache__'].includes(name)) continue;
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(mjs|js|html|md|json|txt|yml|yaml)$/.test(name) || name === 'LICENSE') {
        files.push(p);
      }
    }
  };
  walk(ROOT);

  const findings = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (allowed(line)) return;
      for (const [label, re] of FORBIDDEN) {
        const m = line.match(re);
        if (m) findings.push(`${rel}:${i + 1} [${label}] ${m[0]}`);
      }
    });
  }

  r.ok(findings.length === 0, `${files.length} 个文件里没有隐私或凭据泄漏`,
       findings.slice(0, 5).join(' | '));

  /* 自检：这套规则真的能抓到东西。
     探针必须**分段拼接**，让任何违规模式都不以字面量形式出现在源码里 ——
     否则规则会把自己检查出来。这不是理论问题：第一版我顺手写了本机的
     用户名和主机名，第二版又写了字面量的 SID，两次都被自己抓了出来。
     检查器把自己检查出来，算是功能演示，但源码里不该留这种东西。 */
  const BS = String.fromCharCode(92);
  const probe = [
    'C:' + BS + 'Users' + BS + 'aUser.' + 'LAPTO' + 'P-ABCD1234' + BS + 'work',
    'gh' + 'p_' + 'a'.repeat(25),
    'S-' + '1-' + '5-21-' + '1111111111-' + '2222222222-' + '3333333333-' + '1001',
    'someone' + '@' + 'example.com',
  ].join('  ');

  const caught = FORBIDDEN.filter(([, re]) => new RegExp(re.source, re.flags).test(probe))
    .map(([l]) => l);
  r.ok(caught.length >= 4, '自检：合成的泄漏样本能被这套规则抓到', caught.join(', '));
}

r.group('仓库里不该有构建产物');
{
  const junk = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (name === '.git') continue;
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) {
        if (['node_modules', 'dist', 'build', '__pycache__'].includes(name)) {
          junk.push(path.relative(ROOT, p));
        } else walk(p);
      } else if (/\.(log|tmp|bak|orig|rej|swp)$/.test(name) ||
                 ['Thumbs.db', '.DS_Store'].includes(name)) {
        junk.push(path.relative(ROOT, p));
      }
    }
  };
  walk(ROOT);
  r.ok(junk.length === 0, '没有构建产物、日志或编辑器残留',
       junk.join(', '));
}

/* ================================================================== */
process.exit(r.finish() ? 0 : 1);
