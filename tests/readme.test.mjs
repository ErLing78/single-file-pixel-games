/**
 * readme.test.mjs — 验证 README 里的声称与事实一致
 *
 * 文档最容易出的问题不是写错，而是**过期**：功能改了、数字变了，
 * 文档还停在几个月前。所以 README 里的每一个可验证的说法，
 * 这里都要有一条断言盯着。
 *
 * 最有价值的一条是"636 项断言"这个数字 —— 让它自己验证自己，
 * 而不是靠人手抄。
 *
 * 运行：node tests/readme.test.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GAMES, ROOT } from './lib/load.mjs';
import { createReporter } from './lib/env.mjs';

const r = createReporter('readme —— 文档必须与事实一致');
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* ==================================================================
   1. 声称的断言总数必须等于实际跑出来的总数
   ================================================================== */
r.group('断言总数：README 自己验证自己 ★');
{
  const suites = [
    ['core.test.mjs', 'core'],
    ['smoke.test.mjs', 'smoke'],
    ['systems.test.mjs', 'systems'],
    ['dom-check.mjs', 'dom-check'],
  ];

  let total = 0;
  const counts = {};
  let anyFailed = false;

  for (const [file, key] of suites) {
    const p = path.join(ROOT, 'tests', file);
    const res = spawnSync(process.execPath, [p], { encoding: 'utf8', timeout: 180000 });
    const out = (res.stdout || '') + (res.stderr || '');
    const m = out.match(/全部通过：(\d+) 项/);
    if (m) {
      counts[key] = Number(m[1]);
      total += Number(m[1]);
    } else if (/项失败/.test(out)) {
      counts[key] = null;
      anyFailed = true;
    } else {
      counts[key] = null;
    }
    r.ok(m !== null, `${file} 能正常跑完并报告项数`,
         m ? m[1] + ' 项' : '输出异常：' + out.split('\n').slice(-4).join(' / ').slice(0, 200));
  }

  r.ok(!anyFailed, '四套测试本身没有失败项');
  r.note(`实测合计：${Object.entries(counts).map(([k, v]) => k + ' ' + v).join(' · ')} = ${total} 项`);

  // README 里声明了几处数字，都要对得上
  const claimed = [...readme.matchAll(/(\d+) 条自动化断言/g)].map(m => Number(m[1]));
  const claimedTable = [...readme.matchAll(/\|\s*`?(\w[\w.-]*\.test\.mjs|dom-check\.mjs)`?\s*\|\s*(\d+)\s*\|/g)]
    .map(m => ({ file: m[1], n: Number(m[2]) }));
  const claimedTotal = [...readme.matchAll(/\*\*(\d+)\*\*\s*\|?\s*$/gm)].map(m => Number(m[1]));

  if (claimed.length) {
    r.ok(claimed.every(n => n === total),
         `README 正文里的断言总数与实际一致（${claimed[0]} = ${total}）`,
         claimed.join('/') + ' vs ' + total);
  }
  if (claimedTable.length) {
    let allMatch = true;
    const detail = [];
    for (const c of claimedTable) {
      // 两种文件名形态都要能还原成 counts 里的 key：
      // 'core.test.mjs' → 'core'，'dom-check.mjs' → 'dom-check'
      // （只 replace('.test.mjs') 的话后者会留下尾巴，查表拿到 undefined）
      const key = c.file.replace('.test.mjs', '').replace('.mjs', '');
      const actual = counts[key];
      detail.push(`${key} ${c.n}/${actual}`);
      if (actual !== c.n) allMatch = false;
    }
    r.ok(allMatch, 'README 表格里每套测试的项数都与实际一致', detail.join(' · '));
  }
  if (claimedTotal.length) {
    r.ok(claimedTotal.includes(total), 'README 表格里的合计与实际一致',
         claimedTotal.join('/') + ' vs ' + total);
  }

  // index.html 也声称了同一个数字
  const indexClaimed = [...indexHtml.matchAll(/(\d+) 条自动化断言/g)].map(m => Number(m[1]));
  if (indexClaimed.length) {
    r.ok(indexClaimed.every(n => n === total),
         'index.html 里的断言总数与实际一致',
         indexClaimed.join('/') + ' vs ' + total);
  }
}

/* ==================================================================
   2. README 里提到的每个文件都存在
   ================================================================== */
r.group('README 里链接的文件都存在');
{
  const links = new Set();
  for (const m of readme.matchAll(/\]\(([^)#]+?)(?:#[^)]*)?\)/g)) links.add(m[1]);
  for (const m of indexHtml.matchAll(/(?:href|src)="([^"#:]+?)"/g)) links.add(m[1]);

  const local = [...links].filter(u => !/^https?:/.test(u) && !u.startsWith('//'));
  const missing = local.filter(u => !fs.existsSync(path.join(ROOT, u)));

  r.ok(missing.length === 0, 'README 与落地页里的本地链接都指向真实文件',
       missing.length ? '失效：' + missing.join(', ') : `${local.length} 个链接全部有效`);

  r.ok(local.length >= 10, '确实检查到了一批链接', String(local.length));
}

/* ==================================================================
   3. 代码量声称
   ================================================================== */
r.group('README 表格里的代码量');
{
  // 表格形如：| [breakout.html](games/breakout.html) | ... | ~470 行 |
  const claims = [...readme.matchAll(/games\/([\w-]+)\.html\)[^|]*\|[^|]*\|[^|]*\|\s*~(\d+)\s*行/g)]
    .map(m => ({ id: m[1], claimed: Number(m[2]) }));

  r.ok(claims.length === 5, 'README 为五个游戏都标注了代码量', String(claims.length));

  let allClose = true;
  const detail = [];
  for (const c of claims) {
    const p = path.join(ROOT, 'games', c.id + '.html');
    if (!fs.existsSync(p)) { allClose = false; detail.push(c.id + ' 缺失'); continue; }
    const lines = fs.readFileSync(p, 'utf8').split('\n').length;
    // 允许 ±15% 的漂移，但必须四舍五入到"整十"数量级上的接近
    const ratio = lines / c.claimed;
    detail.push(`${c.id} 声称${c.claimed}/实际${lines}`);
    if (ratio < 0.85 || ratio > 1.15) allClose = false;
  }
  r.ok(allClose, '每个游戏的代码量与文档标注相符（±15%）', detail.join(' · '));
}

/* ==================================================================
   4. 操作说明与代码一致
   ================================================================== */
r.group('README 的操作表与代码一致');
{
  /* 文档说按某个键做什么，代码里就必须真的监听了那个键。
     这类不一致最烦人 —— 玩家照着文档按，什么也没发生。

     匹配按键名时**不能要求它带引号**：有的游戏用 if (k === 'ArrowUp')，
     有的用查表 { ArrowUp: 'up' }。第一版只认带引号的写法，
     于是用查表的贪吃蛇和推箱子被误报为"文档写了但代码没处理"。 */
  const keyClaims = [
    { id: 'snake', keys: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'r'] },
    { id: 'platformer', keys: ['ArrowLeft', 'ArrowRight', 'r'] },
    { id: 'sokoban', keys: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'z', 'r'] },
    { id: 'shooter', keys: ['ArrowLeft', 'ArrowRight'] },
    { id: 'breakout', keys: ['ArrowLeft', 'ArrowRight'] },
  ];

  for (const c of keyClaims) {
    const src = fs.readFileSync(path.join(ROOT, 'games', c.id + '.html'), 'utf8');
    const missing = c.keys.filter(k => !new RegExp(`['"]?${k}['"]?\\s*:`).test(src) &&
                                       !src.includes(`'${k}'`) &&
                                       !src.includes(`"${k}"`));
    r.ok(missing.length === 0, `${c.id}: 文档里写的按键在代码里都有处理`,
         missing.length ? '未处理：' + JSON.stringify(missing) : c.keys.join(' '));
  }

  // 空格键是每个游戏都有的主操作，单独确认
  for (const g of GAMES) {
    const src = fs.readFileSync(path.join(ROOT, 'games', g.id + '.html'), 'utf8');
    r.ok(src.includes("' '") || src.includes('" "'), `${g.id}: 处理了空格键`);
  }
}

/* ==================================================================
   5. 结构约定与事实一致
   ================================================================== */
r.group('README 声明的结构约定');
{
  r.ok(/width="?640"?/.test(readme) || readme.includes('640×360'),
       'README 声明了 640×360 内部分辨率');

  for (const g of GAMES) {
    const html = fs.readFileSync(path.join(ROOT, 'games', g.id + '.html'), 'utf8');
    r.ok(/width="640"\s+height="360"/.test(html),
         `${g.id} 的实际分辨率确实是 640×360`);
  }

  // 文档说"算法区不碰 DOM" —— 这条要被真的检查。
  // 注意必须先剥掉注释：注释里写"不碰 DOM""如果发现需要 window"
  // 是解释性的文字，不是真的引用。第一版没剥注释，于是五个游戏里
  // 唯一在注释中解释了这条规则的 breakout 被误报。
  const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

  for (const g of GAMES) {
    const html = fs.readFileSync(path.join(ROOT, 'games', g.id + '.html'), 'utf8');
    const core = html.match(/\/\* #region CORE[\s\S]*?\/\* #endregion CORE \*\//);
    if (!core) { r.ok(false, `${g.id}: 有算法区`); continue; }
    const code = stripComments(core[0]);
    const hit = code.match(/\b(document|window|canvas|ctx|getElementById|requestAnimationFrame)\b/);
    r.ok(!hit, `${g.id}: 算法区（去掉注释后）确实没有碰 DOM`,
         hit ? '发现了 ' + hit[0] : '');
  }
}

/* ==================================================================
   6. 落地页与游戏清单一致
   ================================================================== */
r.group('落地页完整覆盖五个游戏');
{
  for (const g of GAMES) {
    r.ok(indexHtml.includes(`games/${g.id}.html`), `落地页链接到 ${g.id}`);
    // 卡片上要写出这个游戏教什么
    const card = indexHtml.slice(indexHtml.indexOf(`games/${g.id}.html`));
    r.ok(card.slice(0, 900).includes(g.teaches.split('与')[0].slice(0, 2)),
         `落地页写明了 ${g.id} 教什么`, g.teaches);
  }
  const cardCount = (indexHtml.match(/class="card"/g) || []).length;
  r.ok(cardCount === 5, '落地页正好五张卡片', String(cardCount));
}

/* ==================================================================
   7. 英文文档必须跟上，且与中文版结构一致
   ================================================================== */
r.group('英文文档');
{
  const enPath = path.join(ROOT, 'docs/PATTERNS.en.md');
  if (!fs.existsSync(enPath)) {
    r.ok(false, 'docs/PATTERNS.en.md 存在');
  } else {
    const zh = fs.readFileSync(path.join(ROOT, 'docs/PATTERNS.md'), 'utf8');
    const en = fs.readFileSync(enPath, 'utf8');

    r.ok(en.length > zh.length * 0.5,
         '英文版篇幅与中文版相当（不是占位文件）',
         `${en.length} vs ${zh.length} 字符`);

    /* 章节数一致是关键指标：一边加了新章节而另一边没加，
       英文版就会慢慢落后 —— 这类漂移没有断言盯着就一定会发生。 */
    const zhHead = (zh.match(/^## /gm) || []).length;
    const enHead = (en.match(/^## /gm) || []).length;
    r.ok(enHead === zhHead, '英文版与中文版的章节数一致',
         `中文 ${zhHead} 章 / 英文 ${enHead} 章`);

    const zhCode = (zh.match(/^```/gm) || []).length;
    const enCode = (en.match(/^```/gm) || []).length;
    r.ok(Math.abs(enCode - zhCode) <= 2, '两版代码块数量接近（结构没有走样）',
         `中文 ${zhCode} / 英文 ${enCode}`);

    // 关键概念两边都要讲到
    const concepts = [
      ['fixed timestep', '固定步长'],
      ['coyote', '土狼时间'],
      ['one-way platform', '单向平台'],
      ['immutable', '不可变'],
      ['localStorage', 'localStorage'],
      ['getElementById', 'getElementById'],
      ['overlayKeys', 'overlayKeys'],
    ];
    for (const [enTerm, zhTerm] of concepts) {
      const inZh = zh.includes(zhTerm);
      const inEn = en.toLowerCase().includes(enTerm.toLowerCase());
      r.ok(inZh && inEn, `两版都覆盖了「${zhTerm}」`,
           `中文 ${inZh ? '有' : '缺'} / 英文 ${inEn ? '有' : '缺'}`);
    }

    r.ok(readme.includes('PATTERNS.en.md'), 'README 链接到英文版');
    r.ok(indexHtml.includes('PATTERNS.en.md'), '落地页链接到英文版');
  }
}

/* ==================================================================
   8. 双语支持必须在文档里说明
   ================================================================== */
r.group('双语文档');
{
  r.ok(readme.includes('## 双语'), 'README 有双语说明章节');
  for (const phrase of ['?lang=en', 'L', '浏览器语言']) {
    r.ok(readme.includes(phrase), `README 说明了「${phrase}」`);
  }
  r.ok(indexHtml.includes('双语'), '落地页提到了双语');

  // 五个游戏文件里都要真的能切换
  for (const g of GAMES) {
    const src = fs.readFileSync(path.join(ROOT, 'games', g.id + '.html'), 'utf8');
    r.ok(/const TEXTS = \{/.test(src) && /en: \{/.test(src),
         `${g.id}: 文件里确实装着两种语言`);
    r.ok(/sfpg\.lang/.test(src), `${g.id}: 选择会被记住`);
    r.ok(/\[?&\]?lang=/.test(src) || /lang=\(zh\|en\)/.test(src),
         `${g.id}: 支持 ?lang= URL 参数`);
  }
}

/* ================================================================== */
process.exit(r.finish() ? 0 : 1);
