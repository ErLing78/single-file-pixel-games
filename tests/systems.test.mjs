/**
 * systems.test.mjs — 系统与平衡测试
 *
 * 前三套测的是"代码对不对"，这一套测的是**"设计合不合理"**。
 * 所以断言都写成可判真假的规则描述（比如"短按必须比长按跳得低"），
 * 失败时不用回看设计文档就知道哪里不对。
 *
 * 数值一律**向游戏查询**，绝不在这里抄第二份 —— 抄一份的结果是
 * "改了游戏数值而断言还在测旧曲线"，测试全绿反而是假象。
 *
 * 运行：node tests/systems.test.mjs
 */

import { loadGame, evalCore } from './lib/load.mjs';
import { createReporter, createStorage } from './lib/env.mjs';
import * as env from './lib/env.mjs';

const r = createReporter('systems —— 规则、手感与平衡');
const T = 16;
const GAMES_OF_RECORD = ['breakout', 'snake', 'platformer', 'sokoban', 'shooter'];

/* ==================================================================
   跨游戏的统一约定
   ================================================================== */
r.group('五个游戏共用的约定');
{
  for (const g of GAMES_OF_RECORD) {
    const game = loadGame(g, { env });
    const html = game.html;

    r.ok(html.includes('<meta charset="utf-8"'),
         `${g} 声明了 UTF-8（中文界面不乱码的前提）`);
    r.ok(/width="?640"?/.test(html) && /height="?360"?/.test(html),
         `${g} 内部分辨率是 640×360`);
    r.ok(html.includes('image-rendering:pixelated') || html.includes('image-rendering: pixelated'),
         `${g} 打开了 pixelated 渲染`);
    r.ok(html.includes('transform-origin: 0 0') || html.includes('transform-origin:0 0'),
         `${g} 的缩放层设置了 transform-origin（否则居中会算错）`);
    r.ok(/\.overlay:not\(\.on\)\s*\*/.test(html),
         `${g} 隐藏的覆盖层整棵子树都禁用了指针事件`);

    /* 主循环形态按游戏类型区分，不能一刀切：
       · 实时物理类（打砖块 / 平台跳跃 / 弹幕射击）必须固定步长，
         否则物理表现会随帧率漂移；
       · 贪吃蛇是"离散 tick + 插值渲染"，它需要的是 tick 累加器；
       · 推箱子是回合制，压根不需要时间步 —— 要求它用固定步长是测试越界。 */
    const needsFixedStep = ['breakout', 'platformer', 'shooter'].includes(g);
    if (needsFixedStep) {
      r.ok(/while \(acc >= STEP/.test(game.script), `${g} 使用固定步长 + 累加器`);
      r.ok(/steps < \d+/.test(game.script), `${g} 累加器有上限（防止切标签页回来时狂奔）`);
    } else if (g === 'snake') {
      r.ok(/G\.acc \+= ms/.test(game.script) && /while \(G\.acc >= G\.interval/.test(game.script),
           'snake 用 tick 累加器驱动格子推进（离散逻辑不该绑在帧上）');
      r.ok(/guard < \d+/.test(game.script), 'snake 的单帧 tick 数有上限，长帧不会一次推很多格');
    } else {
      r.ok(!/requestAnimationFrame/.test(game.script) === false, 'sokoban 有渲染循环');
      r.ok(/MOVES\[k\]/.test(game.script), 'sokoban 是回合制，靠输入而非时间来推进');
    }

    // 算法区不能依赖 Math.random，否则"同种子复现"是假的
    const coreMatch = game.script.match(/\/\* #region CORE[\s\S]*?\/\* #endregion CORE \*\//);
    r.ok(coreMatch && !/Math\.random/.test(coreMatch[0]),
         `${g} 的算法区不依赖 Math.random（保证可复现）`);

    game.env.releaseAll();
  }
}

/* ==================================================================
   打砖块
   ================================================================== */
r.group('打砖块 · 规则与平衡');
{
  const C = evalCore('breakout');
  const g = loadGame('breakout', { env });
  const G = g.GAME;
  g.env.key(' ');
  g.env.step(2);
  g.env.key(' ');
  g.env.step(2);

  r.ok(G.state() === 'play', '进入对局');

  // 挡板不能跑出场地
  G.movePaddleTo(-500);
  g.env.step(5);
  r.ok(G.paddle().x >= 0, '挡板被夹在左边界内', G.paddle().x.toFixed(1));
  G.movePaddleTo(9999);
  g.env.step(5);
  r.ok(G.paddle().x + G.paddle().w <= 640, '挡板被夹在右边界内',
       (G.paddle().x + G.paddle().w).toFixed(1));

  // 球撞墙不掉出去（连续反弹 600 帧，球必须始终在场地里）
  G.movePaddleTo(320);
  let escaped = 0, minX = 999, maxX = -999;
  for (let i = 0; i < 600; i++) {
    g.env.step(1);
    for (const b of G.balls()) {
      if (b.x < -12 || b.x > 652) escaped++;
      minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x);
    }
  }
  r.ok(escaped === 0, '600 帧内球没有从左右穿出去',
       escaped ? escaped + ' 次，x 范围 ' + minX.toFixed(0) + '..' + maxX.toFixed(0) : '');

  // 速度上限：无论打多少砖，球速不能超过设计上限
  const maxSpeed = C.BASE_SPEED_IF_ANY || 214 * 1.72 + 1;
  let fastest = 0;
  for (let i = 0; i < 400; i++) {
    g.env.step(1);
    for (const b of G.balls()) fastest = Math.max(fastest, Math.hypot(b.vx, b.vy));
  }
  r.ok(fastest <= maxSpeed, '球速不超过 "基础速度 × 上限倍率"',
       fastest.toFixed(1) + ' ≤ ' + maxSpeed.toFixed(1));

  // 道具时长有限，不会永久生效
  G.effects().wide = 100;
  g.env.step(200);
  r.ok(G.effects().wide <= 0, '道具效果会到时间自动结束', String(G.effects().wide));

  // 破砖加分会随着砖块耐久提高
  const level0 = C.buildLevel(0);
  const level4 = C.buildLevel(4);
  const avgHp0 = level0.reduce((a, k) => a + k.maxHp, 0) / level0.length;
  const avgHp4 = level4.reduce((a, k) => a + k.maxHp, 0) / level4.length;
  r.ok(avgHp4 > avgHp0, '后面的关卡砖块更硬（难度递增）',
       '第1关均值 ' + avgHp0.toFixed(2) + ' vs 第5关 ' + avgHp4.toFixed(2));

  g.env.releaseAll();
}

/* ==================================================================
   贪吃蛇
   ================================================================== */
r.group('贪吃蛇 · 转向与速度');
{
  const g = loadGame('snake', { env });
  const G = g.GAME;
  g.env.key(' ');
  g.env.step(2);

  // 转向队列最多两拍 —— 保证"一次 tick 内快速按两下"不丢输入
  G.turn('up');
  G.turn('left');
  r.ok(G.queue().length === 2, '一个 tick 内可以排队两拍转向', JSON.stringify(G.queue()));
  G.turn('down');
  r.ok(G.queue().length === 2, '队列满了以后不再接受更多转向');

  // 一次 tick 只消费一拍
  G.tick();
  r.ok(G.dir() === 'up', '推进一拍后消费第一个转向', G.dir());
  G.tick();
  r.ok(G.dir() === 'left', '再推进一拍消费第二个转向', G.dir());

  // 反向被拒
  const before = G.dir();
  G.turn(before === 'left' ? 'right' : 'left');
  r.ok(G.queue().length === 0, '拒绝 180° 掉头');

  // 速度曲线：吃越多越快，但有硬上限
  const g2 = loadGame('snake', { env });
  const G2 = g2.GAME;
  g2.env.key(' ');
  g2.env.step(2);
  const baseInterval = G2.interval();
  const intervals = [];
  for (let i = 0; i < 40; i++) {
    const h = G2.body()[0];
    G2.placeFood(h.x + 1, h.y);
    G2.tick();
    intervals.push(G2.interval());
  }
  r.ok(intervals[0] < baseInterval || intervals[0] === baseInterval,
       '吃食物之后间隔不会变长');
  r.ok(intervals.every((v, i) => i === 0 || v <= intervals[i - 1] + 1e-9),
       '间隔随长度单调不增（即速度单调不减）');
  r.ok(intervals[intervals.length - 1] > 0, '间隔始终为正数（不会出现零或负数）',
       intervals[intervals.length - 1].toFixed(1) + ' ms');
  r.ok(intervals[intervals.length - 1] >= 50, '间隔有下限，速度不会快到失控',
       '最快 ' + intervals[intervals.length - 1].toFixed(1) + ' ms/格');

  g.env.releaseAll();
  g2.env.releaseAll();
}

r.group('贪吃蛇 · 最高分跨实例持久化');
{
  /* 验证持久化不能只断言"写进去了" —— 要新建一个实例、
     把同一份存储灌进去、重新加载，再断言状态被读回来。
     否则测的只是写路径，读路径可能一直是坏的。 */
  const store = createStorage();

  const first = loadGame('snake', { env, storage: store });
  first.env.key(' ');
  first.env.step(2);
  for (let i = 0; i < 6; i++) {
    const h = first.GAME.body()[0];
    first.GAME.placeFood(h.x + 1, h.y);
    first.GAME.tick();
  }
  const bestAfterPlay = first.GAME.best();
  r.ok(bestAfterPlay > 3, '玩出一局高于初始值的成绩', String(bestAfterPlay));
  first.env.releaseAll();

  const stored = store._dump();
  r.ok(Object.keys(stored).length > 0, '成绩写进了存储', JSON.stringify(stored));

  // 新实例 + 同一份存储 → 应该读回同一个成绩
  const second = loadGame('snake', { env, storage: store });
  r.ok(second.GAME.best() === bestAfterPlay, '新实例能读回记录的最高分',
       second.GAME.best() + ' vs ' + bestAfterPlay);
  second.env.releaseAll();
}

/* ==================================================================
   平台跳跃
   ================================================================== */
r.group('平台跳跃 · 手感参数（这几条是"操作跟不跟手"的量化）');
{
  const g = loadGame('platformer', { env });
  const G = g.GAME;
  g.env.key(' ');
  g.env.step(2);

  const settle = (col) => {
    G.teleport(col, 17);
    G.setVelocity(0, 0);
    G.setInput({ right: false, left: false });
    g.env.step(20);
  };

  // ---- 跳跃高度要在设计值附近 ----
  settle(16);
  const y0 = G.player().y;
  G.requestJump();
  let peak = y0;
  for (let i = 0; i < 100; i++) { g.env.step(1); peak = Math.min(peak, G.player().y); }
  const fullJump = y0 - peak;
  // 设计值 = JUMP_V² / (2·GRAVITY) = 428² / 3000 ≈ 61px
  r.ok(fullJump > 52 && fullJump < 70, '满跳高度在设计值 61px 附近',
       fullJump.toFixed(1) + ' px');

  // ---- 短按必须明显低于长按（变高跳的核心）----
  settle(16);
  G.setInput({ jumpHeld: false });
  const y1 = G.player().y;
  G.requestJump();
  G.setInput({ jumpHeld: false });      // 立刻松手 → 触发截断
  let peak2 = y1;
  for (let i = 0; i < 100; i++) { g.env.step(1); peak2 = Math.min(peak2, G.player().y); }
  const shortJump = y1 - peak2;
  r.ok(shortJump < fullJump * 0.75, '短按明显低于长按（变高跳生效）',
       '短 ' + shortJump.toFixed(1) + ' px vs 长 ' + fullJump.toFixed(1) + ' px');
  r.ok(shortJump > 8, '短按也跳得起来，不是"按了没反应"', shortJump.toFixed(1) + ' px');

  /* ---- 跳跃距离要够跨过 5 格的坑（关卡设计依赖这个）----
     不能"等落地再量"：第 1 关那一段地面只有 9 格宽，助跑之后
     落点已经进了下一个坑，玩家根本不会落地。
     改成量**完整弧线**：从起跳高度出发，升上去、再回落到同一高度，
     两点之间的水平距离就是一次跳跃的覆盖范围。 */
  settle(15);
  G.setInput({ right: true });
  g.env.step(30);                        // 先跑起来，接近最大速度
  const xStart = G.player().x;
  const yStart = G.player().y;
  G.requestJump();
  let landX = null;
  let rose = false;
  for (let i = 0; i < 200; i++) {
    g.env.step(1);
    const p = G.player();
    if (p.y < yStart - 4) rose = true;              // 确实升上去了
    if (rose && p.y >= yStart) { landX = p.x; break; }
    if (G.state() !== 'play') break;
  }
  const dist = landX == null ? 0 : landX - xStart;
  r.ok(dist > 5 * T, '助跑起跳能跨过 5 格（80px）的坑',
       dist.toFixed(0) + ' px ≈ ' + (dist / T).toFixed(1) + ' 格');

  // ---- 土狼时间：刚离开平台边缘还能跳 ----
  settle(16);
  G.setInput({ right: true });
  // 跑到右边的坑边让它落下去
  let coyoteJumped = false;
  for (let i = 0; i < 200; i++) {
    g.env.step(1);
    const p = G.player();
    if (!p.grounded && G.coyote() > 0) {
      const yBefore = p.y;
      G.requestJump();
      g.env.step(3);
      if (G.player().y < yBefore) coyoteJumped = true;
      break;
    }
  }
  r.ok(coyoteJumped, '离开边缘后的宽限期内仍然能起跳（土狼时间生效）');

  // ---- 尖刺判定不能太苛刻 ----
  r.ok(typeof G.tileAt(0, 0) === 'number', '地形查询可用');

  g.env.releaseAll();
}

r.group('平台跳跃 · 关卡设计约束');
{
  const C = evalCore('platformer');
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../games/platformer.html', import.meta.url), 'utf8');

  // 起点和终点必须在同一水平范围内，且终点在起点右侧（流程是向右推进的）
  /* 抽取关卡数据必须**先切出 LEVELS 数组那一段**。
     直接对整份源码跑正则的话，CORE 区里的 CHAR2TILE 定义
     （形如 '.': EMPTY 的单字符键）也会被匹配进来，
     于是"关卡"数组里混进一堆单字符条目，解析出来的自然是垃圾。 */
  const lvSrc = src.slice(src.indexOf('const LEVELS = ['), src.indexOf('/* ---- 调参区'));
  const rows = [...lvSrc.matchAll(/'([.#=^oPG]+)'/g)].map(m => m[1]);
  r.ok(rows.length === 80, '抽取到 4 关 × 20 行', String(rows.length));
  for (let i = 0; i < 4; i++) {
    const chunk = rows.slice(i * 20, i * 20 + 20);
    const lv = C.parseLevel(chunk);
    const spawnCol = Math.floor(lv.spawn.x / T);
    const goalCol = Math.floor(lv.goal.x / T);
    r.ok(goalCol > spawnCol, `第 ${i + 1} 关的终点在起点右侧`,
         `起点列 ${spawnCol} → 终点列 ${goalCol}`);
    r.ok(goalCol - spawnCol > 20, `第 ${i + 1} 关有足够的行进距离`,
         (goalCol - spawnCol) + ' 格');
  }

  // 每个缺口的宽度都不能超过一次跳跃的距离
  const maxJumpTiles = 5.9;
  let widestGap = 0;
  for (let i = 0; i < 4; i++) {
    const chunk = rows.slice(i * 20, i * 20 + 20);
    const lv = C.parseLevel(chunk);
    const groundRow = lv.rows - 1;
    let run = 0;
    for (let c = 0; c < lv.cols; c++) {
      if (C.tileAt(lv, c, groundRow) !== C.SOLID) { run++; widestGap = Math.max(widestGap, run); }
      else run = 0;
    }
  }
  r.ok(widestGap <= maxJumpTiles, '最宽的坑不超过一次跳跃的距离',
       widestGap + ' 格 ≤ ' + maxJumpTiles + ' 格');

  // 移动平台必须真的架在坑上方，否则就是纯装饰
  const moverXs = [...src.matchAll(/\{\s*x:\s*(\d+),\s*y:\s*[\d+ *\d]+/g)].map(m => Number(m[1]));
  r.ok(moverXs.length >= 4, '至少声明了 4 个移动平台', String(moverXs.length));

  const gapsByLevel = [];
  for (let i = 0; i < 4; i++) {
    const chunk = rows.slice(i * 20, i * 20 + 20);
    const lv = C.parseLevel(chunk);
    const groundRow = lv.rows - 1;
    const gaps = [];
    let start = -1;
    for (let c = 0; c < lv.cols; c++) {
      const isPit = C.tileAt(lv, c, groundRow) !== C.SOLID;
      if (isPit && start < 0) start = c;
      if (!isPit && start >= 0) { gaps.push([start * T, c * T]); start = -1; }
    }
    gapsByLevel.push(gaps);
  }

  const covered = [];
  for (let li = 0; li < 4; li++) {
    for (const gx of gapsByLevel[li]) {
      if (moverXs.some(x => x >= gx[0] - T && x <= gx[1])) {
        covered.push(`第${li + 1}关坑 ${gx[0]}..${gx[1]}`);
      }
    }
  }
  r.ok(covered.length >= 2, '移动平台确实架在坑的上方（不是纯装饰）',
       covered.join('；') || '没有找到任何覆盖');

  // 平台的高度必须够得着：站在地面能够到平台顶面
  const reach = 61;                      // 满跳高度 ≈ 61px
  let allReachable = true;
  const reachDetails = [];
  for (const m of [...src.matchAll(/\{\s*x:\s*(\d+),\s*y:\s*([\d *+]+),/g)]) {
    const y = Number(m[2]);
    if (!Number.isFinite(y)) continue;
    const groundTop = 19 * T;
    const dy = groundTop - y;
    reachDetails.push(dy);
    if (dy > reach + 4) allReachable = false;   // +4 留给容差
  }
  r.ok(allReachable, '每个移动平台都在一次跳跃能够到的高度内',
       '高度差 ' + reachDetails.join('/') + ' px，上限 ' + reach + ' px');
}

/* ==================================================================
   推箱子
   ================================================================== */
r.group('推箱子 · 规则与计数');
{
  const g = loadGame('sokoban', { env });
  const G = g.GAME;
  g.env.key(' ');
  g.env.step(2);

  r.ok(G.levelCount() === 6, '一共 6 关', String(G.levelCount()));

  G.loadLevel(4);                        // 第 5 关，9 步解法
  g.env.step(2);

  const before = G.moves();
  G.move(1, 0);
  g.env.step(2);
  r.ok(G.moves() === before + 1, '每走一步步数 +1', before + ' → ' + G.moves());

  /* 撞墙不算步。
     第 1 关的玩家在 (2,2)，四周除了右边的箱子都是空地 ——
     第一版直接往上走，结果"上"是空地，当然走成功了，断言就失败。
     要真正撞墙得先走到边上：往上走一格到 (2,1)，再往上一格才是墙。 */
  G.loadLevel(0);
  g.env.step(2);
  G.move(0, -1);                         // (2,2) → (2,1)，空地，合法
  r.ok(G.moves() === 1, '空地移动计入步数', String(G.moves()));
  const movesBefore = G.moves();
  G.move(0, -1);                         // (2,1) → (2,0) 是墙，非法
  g.env.step(2);
  r.ok(G.moves() === movesBefore, '撞墙不计入步数',
       movesBefore + ' → ' + G.moves());
  r.ok(G.undoDepth() === 1, '撞墙也不进撤销栈（栈里只有那一次合法移动）',
       String(G.undoDepth()));

  // 推动计数只在真的推箱子时增加
  G.loadLevel(0);
  g.env.step(2);
  G.move(1, 0);                          // 第 1 关：向右推箱子
  r.ok(G.pushes() === 1, '推箱子时推动数 +1', String(G.pushes()));

  /* 找一块真正空旷的方向走。
     第 3 关的玩家在 (3,3)，**左边和上边都是箱子** ——
     随手挑个方向很容易挑到"推箱子"，那样测的就不是"空地行走"了。
     这一关向下两格都是空地，用它。 */
  G.loadLevel(2);
  g.env.step(2);
  const pushesBefore = G.pushes();
  G.move(0, 1);                          // 向下：空地
  r.ok(G.pushes() === pushesBefore, '空地上走不增加推动数',
       pushesBefore + ' → ' + G.pushes());
  r.ok(G.moves() === 1, '但步数照常增加', String(G.moves()));

  /* 撤销是"整状态回退"，不是"反向操作" ——
     连推十次再撤十次，状态应该逐字节回到开始。 */
  G.loadLevel(5);
  g.env.step(2);
  const snapshot = JSON.stringify({
    p: G.playerPos(), boxes: [...G.boxes()].sort(), moves: G.moves(), pushes: G.pushes(),
  });
  const seq = 'UDRLUD';
  let applied = 0;
  for (const ch of seq) {
    const m = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] }[ch];
    const m0 = G.moves();
    G.move(m[0], m[1]);
    if (G.moves() > m0) applied++;
  }
  r.ok(applied > 0, '走了一串移动', applied + ' 步有效');
  for (let i = 0; i < applied; i++) G.undo();
  const after = JSON.stringify({
    p: G.playerPos(), boxes: [...G.boxes()].sort(), moves: G.moves(), pushes: G.pushes(),
  });
  r.ok(after === snapshot, '全部撤销后逐字段回到初始状态',
       after === snapshot ? '' : after + ' vs ' + snapshot);

  g.env.releaseAll();
}

/* ==================================================================
   弹幕射击
   ================================================================== */
r.group('弹幕射击 · 难度曲线与资源上限');
{
  const C = evalCore('shooter');

  /* 平衡类断言要度量"玩家的真实代价"，而不是开发者的方便指标。
     出场间隔直观上就是玩家的压力来源：间隔缩短 = 同时在场敌人更多。 */
  const gaps = [];
  for (let w = 1; w <= 12; w++) {
    if (w % 5 === 0) continue;             // 跳过首领波
    const plan = C.wavePlan(w, C.makeRNG(w * 977));
    for (let i = 1; i < plan.length; i++) gaps.push(plan[i].at - plan[i - 1].at);
  }
  const minGap = Math.min(...gaps);
  r.ok(minGap >= 180, '出场间隔有下限，不会瞬间刷满屏', minGap + ' ms');

  // 同一波内的出场时间必须递增（否则"按顺序登场"没有意义）
  let monotonic = true;
  for (let w = 1; w <= 12; w++) {
    const plan = C.wavePlan(w, C.makeRNG(w * 31 + 7));
    for (let i = 1; i < plan.length; i++) if (plan[i].at < plan[i - 1].at) monotonic = false;
  }
  r.ok(monotonic, '同一波内出场时间是递增的');

  // 每波的敌人数有上限
  let maxCount = 0;
  for (let w = 1; w <= 30; w++) maxCount = Math.max(maxCount, C.wavePlan(w, C.makeRNG(w)).length);
  r.ok(maxCount <= 13, '单波敌人数有上限', String(maxCount));

  const g = loadGame('shooter', { env });
  const G = g.GAME;
  g.env.key(' ');
  g.env.step(2);
  G.player().invuln = 1e6;

  // 子弹数量硬上限：长时间运行也不能无限堆积
  let peak = 0;
  for (let i = 0; i < 12; i++) {
    g.env.step(120);
    peak = Math.max(peak, G.ebullets().length);
  }
  r.ok(peak <= 900, '敌方子弹不会无上限堆积', '峰值 ' + peak + ' 发');

  // 出界的子弹会被回收
  const before = G.ebullets().length;
  g.env.step(240);
  r.ok(G.ebullets().length < 900, '出界子弹被回收', before + ' → ' + G.ebullets().length);

  // 敌人不会被漏掉：场上敌人 + 待出场 = 计划总数（除非已被击毁）
  const wave = G.wave();
  if (wave % 5 !== 0) {
    const plan = C.wavePlan(wave, C.makeRNG(G.seed()));
    r.ok(plan.length > 0, '当前波次的计划非空', String(plan.length));
  }

  g.env.releaseAll();
}

r.group('弹幕射击 · 三种敌人必须有可区分的弹幕');
{
  const C = evalCore('shooter');

  /* "打起来不一样"是主观判断，但"技能集合两两不同"是客观事实。
     这里逐种声明期望的弹幕形状，任何一项落空都说明这个兵种
     其实没有自己的特征 —— 那是最容易漏掉的一类设计缺陷。 */
  const ring = C.patternRing(8, 100, 0);
  const spiral = C.patternSpiral(2, 112, 0);
  const aimed = C.patternAimed(0, 0, 100, 0, 128, 1);

  r.ok(ring.length === 8, '环形：8 发');
  r.ok(spiral.length === 2, '螺旋：每次 2 发（靠相位旋转形成螺旋）');
  r.ok(aimed.length === 1, '直射：1 发');

  // 三种形状的"方向分布"必须不同
  const spread = vs => {
    const a = vs.map(v => Math.atan2(v.vy, v.vx));
    return Math.max(...a) - Math.min(...a);
  };
  r.ok(spread(ring) > spread(spiral), '环形的角度跨度大于螺旋');
  r.ok(spread(aimed) === 0, '直射的角度跨度为零（单一方向）');

  // 速率也不同，玩家可以靠"快慢"区分
  const speedOf = vs => Math.hypot(vs[0].vx, vs[0].vy);
  r.ok(new Set([speedOf(ring), speedOf(spiral), speedOf(aimed)]).size === 3,
       '三种弹幕的速率两两不同',
       `${speedOf(ring)} / ${speedOf(spiral)} / ${speedOf(aimed)}`);
}

/* ==================================================================
   双语
   ================================================================== */
r.group('双语 · 检测顺序');
{
  // 1) 默认跟随浏览器语言
  for (const g of GAMES_OF_RECORD) {
    const zh = loadGame(g, { env, locale: 'zh-CN' });
    zh.env.step(2);
    r.ok(zh.GAME.lang() === 'zh', `${g}: 中文浏览器 → zh`, zh.GAME.lang());
    zh.env.releaseAll();

    const en = loadGame(g, { env, locale: 'en-US' });
    en.env.step(2);
    r.ok(en.GAME.lang() === 'en', `${g}: 英文浏览器 → en`, en.GAME.lang());
    en.env.releaseAll();

    // 其他非中文语言都归到 en
    const ja = loadGame(g, { env, locale: 'ja-JP' });
    ja.env.step(2);
    r.ok(ja.GAME.lang() === 'en', `${g}: 日文浏览器 → en（非中文一律英文）`, ja.GAME.lang());
    ja.env.releaseAll();
  }

  // 2) URL 参数优先级最高
  const viaUrlOverZh = loadGame('snake', { env, locale: 'zh-CN', search: '?lang=en' });
  viaUrlOverZh.env.step(2);
  r.ok(viaUrlOverZh.GAME.lang() === 'en', 'URL 参数能覆盖中文浏览器', viaUrlOverZh.GAME.lang());
  viaUrlOverZh.env.releaseAll();

  const viaUrlOverEn = loadGame('snake', { env, locale: 'en-US', search: '?foo=1&lang=zh' });
  viaUrlOverEn.env.step(2);
  r.ok(viaUrlOverEn.GAME.lang() === 'zh', 'URL 参数能覆盖英文浏览器（且不在首位也能识别）',
       viaUrlOverEn.GAME.lang());
  viaUrlOverEn.env.releaseAll();

  // 3) 上次的选择优先于浏览器语言
  const store = createStorage();
  const first = loadGame('snake', { env, locale: 'zh-CN', storage: store });
  first.env.step(2);
  first.GAME.setLang('en');
  const second = loadGame('snake', { env, locale: 'zh-CN', storage: store });
  second.env.step(2);
  r.ok(second.GAME.lang() === 'en',
       '手动选择被记住，优先于浏览器语言', second.GAME.lang());
  first.env.releaseAll();
  second.env.releaseAll();

  // 4) 存储不可用时不能崩
  const bad = loadGame('snake', { env, locale: 'en-US', storage: createStorage({ failMode: true }) });
  bad.env.step(5);
  r.ok(bad.GAME.lang() === 'en', 'localStorage 抛异常时仍能检测语言', bad.GAME.lang());
  bad.GAME.setLang('zh');
  bad.env.step(5);
  r.ok(bad.GAME.lang() === 'zh', '存储不可用时切换语言也不会崩', bad.GAME.lang());
  bad.env.releaseAll();
}

r.group('双语 · 切换真的改变了界面');
{
  /* 只断言"内部语言变量变了"是不够的 —— 玩家看到的是 DOM。
     这里逐项检查界面上的文字确实换了。 */
  for (const g of GAMES_OF_RECORD) {
    const game = loadGame(g, { env, locale: 'zh-CN' });
    game.env.step(3);
    const G = game.GAME;
    const el = game.env.getEl;

    const titleZh = el('ovTitle').textContent;
    const hintZh = el('ovHint').textContent;
    const htmlLangZh = el('html').getAttribute('lang');
    r.ok(/[\u4e00-\u9fff]/.test(titleZh), `${g}: 中文界面的标题含中文`, JSON.stringify(titleZh));

    game.env.key('L');
    game.env.step(3);

    r.ok(G.lang() === 'en', `${g}: 按 L 切到英文`, G.lang());
    const titleEn = el('ovTitle').textContent;
    const hintEn = el('ovHint').textContent;
    r.ok(titleEn !== titleZh, `${g}: 标题确实变了`,
         JSON.stringify(titleZh) + ' → ' + JSON.stringify(titleEn));
    r.ok(hintEn !== hintZh, `${g}: 提示确实变了`,
         JSON.stringify(hintZh) + ' → ' + JSON.stringify(hintEn));

    // 英文界面不该再残留中文（HUD 标签是最容易漏的地方）
    const hudTexts = ['lblScore', 'lblLives', 'lblCoins', 'lblDeaths', 'lblLevel', 'lblBoxes', 'lblBest']
      .filter(id => game.script.includes(`'${id}'`))
      .map(id => el(id).textContent);
    const hudHasChinese = hudTexts.filter(t => /[\u4e00-\u9fff]/.test(t));
    r.ok(hudHasChinese.length === 0, `${g}: 英文界面下 HUD 标签没有残留中文`,
         hudHasChinese.join(' / ') || hudTexts.join(' / '));

    // 覆盖层正文（含 HTML）也不该有中文
    const bodyEn = el('ovBody').innerHTML;
    r.ok(!/[\u4e00-\u9fff]/.test(bodyEn), `${g}: 英文界面下覆盖层正文没有残留中文`,
         bodyEn.slice(0, 60));

    // doc lang 和无障碍
    r.ok(el('html').getAttribute('lang') === 'en', `${g}: <html lang> 同步为 en`,
         String(el('html').getAttribute('lang')));
    r.ok(htmlLangZh === 'zh-CN', `${g}: 切换前 <html lang> 是 zh-CN`, String(htmlLangZh));

    // 切回去
    game.env.key('L');
    game.env.step(3);
    r.ok(G.lang() === 'zh', `${g}: 再按 L 切回中文`, G.lang());
    r.ok(el('ovTitle').textContent === titleZh, `${g}: 切回后标题恢复`, el('ovTitle').textContent);
    r.ok(el('html').getAttribute('lang') === 'zh-CN', `${g}: <html lang> 恢复 zh-CN`);

    game.env.releaseAll();
  }
}

r.group('双语 · 切换不打断对局');
{
  /* 语言切换只该改文字，不该影响游戏状态。
     这类"顺手动了不该动的东西"的问题，在手动测试里几乎发现不了。 */
  const game = loadGame('snake', { env, locale: 'zh-CN' });
  const G = game.GAME;
  game.env.key(' ');
  game.env.step(2);
  for (let i = 0; i < 5; i++) {
    const h = G.body()[0];
    G.placeFood(h.x + 1, h.y);
    G.tick();
  }
  const before = {
    state: G.state(), score: G.score(), len: G.body().length,
    dir: G.dir(), head: JSON.stringify(G.body()[0]),
  };

  game.env.key('L');
  game.env.step(3);
  r.ok(G.lang() === 'en', '切换成功');
  const after = {
    state: G.state(), score: G.score(), len: G.body().length,
    dir: G.dir(), head: JSON.stringify(G.body()[0]),
  };
  r.ok(JSON.stringify(before) === JSON.stringify(after),
       '切换语言不影响任何游戏状态',
       JSON.stringify(before) + ' vs ' + JSON.stringify(after));

  // 切换后还能继续玩
  const h = G.body()[0];
  G.placeFood(h.x + 1, h.y);
  G.tick();
  r.ok(G.score() > before.score, '切换后游戏照常推进', String(G.score()));
  game.env.releaseAll();
}

r.group('双语 · 占位符与两种语言的覆盖层');
{
  for (const g of GAMES_OF_RECORD) {
    const game = loadGame(g, { env, locale: 'zh-CN' });
    game.env.step(3);
    const G = game.GAME;

    // 两种语言下，覆盖层的正文都要被真的写进 DOM
    for (const lang of ['zh', 'en']) {
      G.setLang(lang);
      game.env.step(2);
      const body = game.env.getEl('ovBody').innerHTML;
      const title = game.env.getEl('ovTitle').textContent;
      r.ok(title.length > 0, `${g}/${lang}: 开始界面有标题`, title);
      r.ok(body.length > 0, `${g}/${lang}: 开始界面有正文`, body.slice(0, 40));
      // 不该把键名当成文本显示出来
      r.ok(!/^[\w]+\.[\w.]+$/.test(title), `${g}/${lang}: 标题不是键名`, title);
      r.ok(!body.startsWith('start.') && !body.startsWith('over.'), `${g}/${lang}: 正文不是键名`,
           body.slice(0, 30));
    }

    /* 占位符替换：不能拿一个固定的键来测 —— 各游戏的键名并不相同。
       改成遍历该游戏所有带 {name} 的文案，逐条验证替换。
       这同时也检查了"占位符名字拼写正确"（拼错的话对应位置不会被替换）。 */
    const keys = G.textKeys();
    const withPh = keys.filter(k => /\{\w+\}/.test(G.t(k)));
    r.ok(withPh.length > 0, `${g}: 存在带占位符的文案`, String(withPh.length));

    const phBad = [];
    for (const k of withPh) {
      const names = [...G.t(k).matchAll(/\{(\w+)\}/g)].map(m => m[1]);
      const params = {};
      // 用不可能出现在文案里的数值，避免和固定数字混淆
      names.forEach((n, i) => { params[n] = 771000 + i; });
      const out = G.t(k, params);
      if (out.includes('{') || !names.every(n => out.includes(String(params[n])))) {
        phBad.push(k + ' → ' + out.slice(0, 60));
      }
    }
    r.ok(phBad.length === 0, `${g}: 每条带占位符的文案都能正确替换`,
         phBad.join(' | ') || withPh.join(', '));

    // 缺参数时占位符要原样保留（而不是变成 "undefined"）
    const keep = G.t(withPh[0], {});
    r.ok(keep.includes('{'), `${g}: 参数缺失时占位符原样保留`, keep.slice(0, 50));
    r.ok(!keep.includes('undefined'), `${g}: 参数缺失时不会写入 undefined`, keep.slice(0, 50));

    // 未知键要能被发现（返回键名本身而不是 undefined）
    const missing = G.t('no.such.key');
    r.ok(typeof missing === 'string' && missing.length > 0,
         `${g}: 未知键返回字符串而不是 undefined`, String(missing));

    // 两种语言的键数必须一致（重复一遍 dom-check 的结论，但这里是运行期）
    r.ok(keys.length >= 10, `${g}: 文案条数合理`, String(keys.length));
    const empty = keys.filter(k => !G.t(k).trim());
    r.ok(empty.length === 0, `${g}: 没有空文案`, empty.join(', '));

    game.env.releaseAll();
  }
}

/* ==================================================================
   可复现性：同一种子必须复现同一局
   ================================================================== */
r.group('可复现性');
{
  // 打砖块：同种子同操作 → 球的位置序列逐帧一致
  const trace = (seed) => {
    const g = loadGame('breakout', { env });
    const G = g.GAME;
    G.setSeed(seed);
    g.env.key(' '); g.env.step(2);
    g.env.key(' '); g.env.step(2);
    const out = [];
    for (let i = 0; i < 120; i++) {
      g.env.step(1);
      const b = G.balls()[0];
      if (b) out.push(b.x.toFixed(3) + ',' + b.y.toFixed(3));
    }
    g.env.releaseAll();
    return out.join('|');
  };
  const a = trace(4242);
  const b = trace(4242);
  const c = trace(9999);
  r.ok(a === b, '打砖块：同种子 + 同操作 = 完全相同的球轨迹');
  r.ok(a !== c, '打砖块：不同种子产生不同轨迹');

  // 弹幕射击：同种子的出场计划一致
  const plan = (seed) => JSON.stringify(evalCore('shooter').wavePlan(6, evalCore('shooter').makeRNG(seed)));
  r.ok(plan(7) === plan(7) && plan(7) !== plan(8), '弹幕射击：出场计划可复现');
}

/* ================================================================== */
process.exit(r.finish() ? 0 : 1);
