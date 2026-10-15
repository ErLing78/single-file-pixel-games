/**
 * core.test.mjs — 算法单元测试
 *
 * 只测 #region CORE 区：把它们从 HTML 里抠出来，在没有任何 DOM 的环境里
 * 直接求值。这一层测的是"性质"而不是"跑通就行"——
 * 比如寻路要和独立实现比对、环形弹幕要断言角度均匀。
 *
 * 运行：node tests/core.test.mjs
 */

import { evalCore } from './lib/load.mjs';
import { createReporter } from './lib/env.mjs';

const r = createReporter('core —— 五个游戏的纯算法');

/* ==================================================================
   打砖块
   ================================================================== */
r.group('打砖块 · 随机数与关卡数据');
{
  const C = evalCore('breakout');

  const a = C.makeRNG(12345), b = C.makeRNG(12345);
  let same = true;
  for (let i = 0; i < 200; i++) if (a() !== b()) same = false;
  r.ok(same, '同一个种子产生完全相同的序列');

  const c = C.makeRNG(999);
  r.ok(c() !== C.makeRNG(12345)(), '不同种子产生不同序列');

  let inRange = true;
  const g = C.makeRNG(7);
  for (let i = 0; i < 500; i++) { const v = g(); if (v < 0 || v >= 1) inRange = false; }
  r.ok(inRange, '随机数始终落在 [0,1)');

  r.ok(C.LEVELS.length === 5, '共 5 个关卡', '实际 ' + C.LEVELS.length);

  const widths = new Set(C.LEVELS.flat().map(row => row.length));
  r.ok(widths.size === 1 && [...widths][0] === C.COLS,
       '所有关卡行宽一致且等于 COLS', [...widths].join('/') + ' vs ' + C.COLS);

  let totalBricks = 0;
  for (let i = 0; i < C.LEVELS.length; i++) {
    const bricks = C.buildLevel(i);
    totalBricks += bricks.length;
    const inField = bricks.every(k =>
      k.x >= 0 && k.x + k.w <= 640 && k.y >= 0 && k.y + k.h <= 360);
    r.ok(inField, `第 ${i + 1} 关所有砖块都在场地内`, bricks.length + ' 块');

    const hpOk = bricks.every(k => k.hp >= 1 && k.hp <= 3 && k.hp === k.maxHp);
    r.ok(hpOk, `第 ${i + 1} 关耐久值都在 1..3`);

    const noOverlap = bricks.every((k, idx) =>
      bricks.every((o, j) => idx === j || k.x + k.w <= o.x || o.x + o.w <= k.x ||
                             k.y + k.h <= o.y || o.y + o.h <= k.y));
    r.ok(noOverlap, `第 ${i + 1} 关砖块互不重叠`);
  }
  r.note('五关砖块总数 ' + totalBricks);

  // 越界索引要回绕，不能返回空关卡
  r.ok(C.buildLevel(99).length > 0, '越界关卡索引回绕而不是返回空');
  r.ok(C.buildLevel(-1).length > 0, '负数关卡索引也能回绕');
}

r.group('打砖块 · 圆与矩形碰撞');
{
  const C = evalCore('breakout');

  // 相交：法线必须由圆心指向矩形
  const hit = C.circleRect(10, 10, 4, 12, 8, 20, 20);
  r.ok(hit !== null, '相交时返回碰撞信息');
  r.ok(Math.abs(hit.nx + 1) < 1e-6 && Math.abs(hit.ny) < 1e-6, '法线指向矩形（-x 方向）', JSON.stringify(hit));
  r.ok(Math.abs(hit.depth - 2) < 1e-6, '穿透深度正确（r=4, 距离=2 → depth=2）', String(hit.depth));

  // 相离
  r.ok(C.circleRect(0, 0, 3, 100, 100, 10, 10) === null, '相离时返回 null');

  // 正好相切（距离 == 半径）算作命中，边界不能漏
  r.ok(C.circleRect(6, 10, 4, 10, 8, 20, 20) !== null, '恰好相切判定为命中');

  // 圆心落在矩形内部：必须给出退出方向而不是 NaN
  const inside = C.circleRect(20, 18, 4, 12, 8, 20, 20);
  r.ok(inside !== null, '圆心在矩形内部时不返回 null');
  r.ok(Number.isFinite(inside.depth) && inside.depth > 0, '内部退化情况给出正的穿透深度', JSON.stringify(inside));
  r.ok(Math.abs(Math.hypot(inside.nx, inside.ny) - 1) < 1e-6, '内部退化情况的法线是单位向量');

  // 反射：入射角等于出射角
  const refl = C.reflect(3, 4, 0, -1);
  r.ok(Math.abs(refl.vx - 3) < 1e-9 && Math.abs(refl.vy + 4) < 1e-9, '垂直撞墙后 y 分量取反');
  const refl2 = C.reflect(5, 0, -1, 0);
  r.ok(Math.abs(refl2.vx + 5) < 1e-9 && Math.abs(refl2.vy) < 1e-9, '水平撞墙后 x 分量取反');

  // 反射不改变速度大小
  const speedBefore = Math.hypot(7, -11);
  const rr = C.reflect(7, -11, 0.6, 0.8);
  r.ok(Math.abs(Math.hypot(rr.vx, rr.vy) - speedBefore) < 1e-9, '反射保持速度大小不变');

  // 反射两次回到原速度
  const once = C.reflect(7, -11, 0.6, 0.8);
  const twice = C.reflect(once.vx, once.vy, 0.6, 0.8);
  r.ok(Math.abs(twice.vx - 7) < 1e-9 && Math.abs(twice.vy + 11) < 1e-9, '同一法线反射两次回到原速度');
}

r.group('打砖块 · 挡板角度与速度曲线');
{
  const C = evalCore('breakout');

  // 正中命中 → 垂直向上
  const mid = C.paddleBounce(100, 100, 50, 200, 1.0);
  r.ok(Math.abs(mid.vx) < 1e-9 && mid.vy < 0, '正中命中时垂直向上', JSON.stringify(mid));

  // 命中右边缘 → 向右上
  const right = C.paddleBounce(150, 100, 50, 200, 1.0);
  r.ok(right.vx > 0 && right.vy < 0, '命中右边缘时向右上');

  // 命中左边缘 → 向左上
  const left = C.paddleBounce(50, 100, 50, 200, 1.0);
  r.ok(left.vx < 0 && left.vy < 0, '命中左边缘时向左上');

  // 出界偏移要被夹取，不能产生超过 maxAngle 的角度
  const over = C.paddleBounce(5000, 100, 50, 200, 1.0);
  r.ok(Math.abs(over.vx) <= 200 * Math.sin(1.0) + 1e-6, '极端偏移被夹取到最大角', 'vx=' + over.vx.toFixed(2));

  // 三种命中的速度大小一致（角度变、速率不变）
  const s1 = Math.hypot(mid.vx, mid.vy), s2 = Math.hypot(right.vx, right.vy);
  r.ok(Math.abs(s1 - s2) < 1e-6, '不同命中点的出射速率相同', s1.toFixed(3) + ' vs ' + s2.toFixed(3));

  // 速度曲线：单调递增且有上限
  r.ok(C.speedMultiplier(0, 2) === 1, '零命中时倍率为 1');
  /* 这里的取值要避开上限：cap=2 时 1+hits*0.012 在 hits≈84 就已经饱和，
     拿 100 和 200 去比会得到两个相等的 2 —— 断言就变成在测"夹取"而不是"递增"。
     测试取值本身也要考虑实现曲线，否则很容易测错东西。 */
  r.ok(C.speedMultiplier(10, 2) < C.speedMultiplier(30, 2), '命中越多球越快',
       C.speedMultiplier(10, 2).toFixed(3) + ' vs ' + C.speedMultiplier(30, 2).toFixed(3));
  // 饱和点：1 + hits*0.012 达到 cap=2 需要 hits ≈ 83.3，所以取 200/400 才越过去
  r.ok(C.speedMultiplier(200, 2) === C.speedMultiplier(400, 2),
       '越过饱和点后倍率不再增长',
       C.speedMultiplier(200, 2).toFixed(3) + ' vs ' + C.speedMultiplier(400, 2).toFixed(3));
  r.ok(C.speedMultiplier(1e6, 1.72) === 1.72, '球速有硬上限', String(C.speedMultiplier(1e6, 1.72)));

  // 归一化
  const n = C.normalize(3, 4, 10);
  r.ok(Math.abs(Math.hypot(n.vx, n.vy) - 10) < 1e-9, '归一化到指定速率');
  const zero = C.normalize(0, 0, 10);
  r.ok(Number.isFinite(zero.vx) && Number.isFinite(zero.vy), '零向量归一化不会产生 NaN');
}

/* ==================================================================
   贪吃蛇
   ================================================================== */
r.group('贪吃蛇 · 转向缓冲');
{
  const C = evalCore('snake');

  r.ok(C.queueTurn([], 'right', 'up').join() === 'up', '空队列可接受一次转向');
  r.ok(C.queueTurn([], 'right', 'left').length === 0, '禁止 180° 掉头');
  r.ok(C.queueTurn([], 'right', 'right').length === 0, '同方向不算转向');
  r.ok(C.queueTurn([], 'right', 'nonsense').length === 0, '未知方向被忽略');

  // 两拍缓冲：这是"一次 tick 内快速按 上→左"能生效的关键
  let q = C.queueTurn([], 'right', 'up');
  q = C.queueTurn(q, 'right', 'left');
  r.ok(q.length === 2 && q[0] === 'up' && q[1] === 'left',
       '一个 tick 内可以排队两拍', JSON.stringify(q));

  // 相对"队列里最后一个"判掉头，而不是相对当前方向
  const q2 = C.queueTurn(['up'], 'right', 'down');
  r.ok(q2.length === 1, '相对队列末位判掉头（上之后不能直接下）', JSON.stringify(q2));

  // 队列满则丢弃
  let q3 = C.queueTurn([], 'right', 'up');
  q3 = C.queueTurn(q3, 'right', 'left');
  q3 = C.queueTurn(q3, 'right', 'down');
  r.ok(q3.length === 2, '队列最多两拍，超出丢弃', JSON.stringify(q3));
}

r.group('贪吃蛇 · 纯函数式的推进');
{
  const C = evalCore('snake');
  const rng = () => 0.5;

  const s0 = C.initialState(20, 12, C.makeRNG(1), 3);
  const snapshot = JSON.stringify(s0);

  const { state: s1, event } = C.step(s0, 20, 12, rng);
  r.ok(JSON.stringify(s0) === snapshot, 'step 不修改传入的状态（纯函数）');
  r.ok(event === 'move', '正常推进的事件是 move', event);
  r.ok(s1.body[0].x === s0.body[0].x + 1, '朝当前方向前进一格');
  r.ok(s1.body.length === s0.body.length, '没吃东西时长度不变');
  r.ok(s0.body !== s1.body, '返回的是新的数组而非同一个引用');

  // 撞墙
  let wall = C.initialState(6, 6, C.makeRNG(2), 2);
  for (let i = 0; i < 10 && wall.alive; i++) {
    wall = C.step(wall, 6, 6, rng).state;
  }
  r.ok(!wall.alive, '撞墙后 alive 变为 false');

  // 随机走 500 步不崩、不产生 NaN
  let s = C.initialState(24, 14, C.makeRNG(9), 4);
  const dirs = ['up', 'down', 'left', 'right'];
  let ok = true, aliveSteps = 0;
  for (let i = 0; i < 500 && s.alive; i++) {
    const d = dirs[Math.floor(C.makeRNG(i * 7919 + 13)() * 4)];
    s = { ...s, queue: C.queueTurn(s.queue, s.dir, d, 2) };
    s = C.step(s, 24, 14, C.makeRNG(i + 1)).state;
    aliveSteps++;
    if (!s.body.every(c => Number.isInteger(c.x) && Number.isInteger(c.y))) ok = false;
    if (!(s.body[0].x >= 0 && s.body[0].x < 24 && s.body[0].y >= 0 && s.body[0].y < 14)) ok = false;
  }
  r.ok(ok, '随机走 ' + aliveSteps + ' 步后坐标仍然合法');
}

r.group('贪吃蛇 · 生长与自撞（这两处最容易写错）');
{
  const C = evalCore('snake');
  const rng = C.makeRNG(5);

  // 吃到食物：长度必须恰好 +1
  let s = C.initialState(20, 12, rng, 3);
  const head = s.body[0];
  s = { ...s, food: { x: head.x + 1, y: head.y } };
  const beforeLen = s.body.length;
  const res = C.step(s, 20, 12, rng);
  r.ok(res.event === 'eat', '进入食物格时事件是 eat', res.event);
  r.ok(res.state.body.length === beforeLen + 1,
       '吃一次食物长度恰好 +1（曾经的 bug 是 +2）',
       beforeLen + ' → ' + res.state.body.length);
  r.ok(res.state.score === s.score + 1, '分数 +1');

  // 连续两步的总长度只增加 1
  const s2 = C.step(res.state, 20, 12, rng).state;
  r.ok(s2.body.length === beforeLen + 1, '下一 tick 长度不再增长', String(s2.body.length));

  // 追自己的尾巴是合法的
  let t = C.initialState(10, 10, C.makeRNG(3), 4);
  // 摆成一个 2x2 的环，头朝右、尾巴在头的左侧
  t = { ...t, body: [{ x: 4, y: 4 }, { x: 4, y: 5 }, { x: 3, y: 5 }, { x: 3, y: 4 }],
        dir: 'up', queue: [], food: { x: 9, y: 9 } };
  // 头往左走到 (3,4) —— 那里正是尾巴，但不生长时尾巴会让开
  t = { ...t, queue: C.queueTurn([], 'up', 'left') };
  const tailRes = C.step(t, 10, 10, C.makeRNG(4));
  r.ok(tailRes.event === 'move' && tailRes.state.alive,
       '追着尾巴走不会死（尾部这一 tick 会让开）', tailRes.event);

  // 但撞到身体中段要死
  let m = { ...t, body: [{ x: 4, y: 4 }, { x: 3, y: 4 }, { x: 3, y: 5 }, { x: 4, y: 5 }],
            dir: 'up', queue: [] };
  m = { ...m, queue: C.queueTurn([], 'up', 'left') };
  const midRes = C.step(m, 10, 10, C.makeRNG(4));
  r.ok(midRes.event === 'die', '撞到身体中段会死', midRes.event);
}

r.group('贪吃蛇 · 食物生成与速度曲线');
{
  const C = evalCore('snake');

  // 食物永远不在蛇身上
  let clean = true;
  for (let seed = 0; seed < 200; seed++) {
    const rng = C.makeRNG(seed);
    const s = C.initialState(16, 10, rng, 5);
    if (!s.food) continue;
    if (s.body.some(c => c.x === s.food.x && c.y === s.food.y)) clean = false;
  }
  r.ok(clean, '200 个种子下食物都不生成在蛇身上');

  // 蛇占满棋盘时返回 null
  const full = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) full.push({ x, y });
  r.ok(C.spawnFood(full, 3, 3, C.makeRNG(1)) === null, '棋盘占满时食物返回 null');

  // 速度曲线
  const base = C.tickInterval(3, 132, 58, 2.6);
  r.ok(base === 132, '初始分数对应基础间隔', String(base));
  r.ok(C.tickInterval(10, 132, 58, 2.6) < base, '分数越高间隔越短');
  r.ok(C.tickInterval(1e6, 132, 58, 2.6) === 58, '间隔有下限（速度有上限）');

  // 插值
  r.ok(C.lerp(0, 10, 0.5) === 5, 'lerp 中点正确');
  r.ok(C.lerp(4, 8, 0) === 4 && C.lerp(4, 8, 1) === 8, 'lerp 端点正确');
}

/* ==================================================================
   平台跳跃
   ================================================================== */
r.group('平台跳跃 · 关卡解析');
{
  const C = evalCore('platformer');

  const lv = C.parseLevel([
    '#####',
    '#P.G#',
    '#####',
  ]);
  r.ok(lv.cols === 5 && lv.rows === 3, '解析出正确的尺寸');
  r.ok(lv.spawn.x === C.TILE + 2, '出生点列正确');
  r.ok(lv.goal !== null && lv.goal.x === 3 * C.TILE, '终点位置正确');
  r.ok(C.tileAt(lv, 0, 0) === C.SOLID, '左上角是实心');
  r.ok(C.tileAt(lv, 1, 1) === C.EMPTY, '内部是空');

  /* 越界规则。这三条最初写的是「下方越界 = 实心」，理由是"防止掉出世界" ——
     但那等于在整个关卡下面铺了一层隐形地板，玩家掉进坑里不会摔死，
     而是落在看不见的地面上被坑壁夹死。**测试当时把这个错误行为写成了断言**，
     所以它才一直没被发现。规格写错时，测试不但不会帮忙，还会帮着掩盖。 */
  r.ok(C.tileAt(lv, -1, 1) === C.SOLID, '左越界当作实心（关卡外墙）');
  r.ok(C.tileAt(lv, 5, 1) === C.SOLID, '右越界当作实心（关卡外墙）');
  r.ok(C.tileAt(lv, 1, -1) === C.EMPTY, '上越界当作空（允许跳出屏幕顶）');
  r.ok(C.tileAt(lv, 1, 99) === C.EMPTY, '下越界当作空（让玩家掉出去摔死，而不是踩隐形地板）');

  const one = C.parseLevel(['#==#', '#PG#']);
  r.ok(C.tileAt(one, 1, 0) === C.ONEWAY, '单向平台解析正确');

  // 金币计数
  const coins = C.parseLevel(['#ooo#', '#P.G#']);
  r.ok(coins.coins.length === 3, '金币被单独收集出来', String(coins.coins.length));

  /* 缺出生点必须报错，不能静默给个默认坐标。
     静默兜底的后果是关卡作者把 @ 打错字符，游戏照常启动、
     玩家却在墙里或角落出生，而错误信息指向完全无关的地方。 */
  let threwSpawn = false;
  try { C.parseLevel(['###', '#.#']); } catch (e) { threwSpawn = true; }
  r.ok(threwSpawn, '缺出生点时报错而不是静默');

  let threwGoal = false;
  try { C.parseLevel(['###', '#P#']); } catch (e) { threwGoal = true; }
  r.ok(threwGoal, '缺终点时也报错');

  // 四个内置关卡都必须能正常解析
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../games/platformer.html', import.meta.url), 'utf8');
  const lvBlock = src.slice(src.indexOf('const LEVELS = ['), src.indexOf('/* ---- 调参区'));
  const rows = [...lvBlock.matchAll(/'([.#=^oPG]+)'/g)].map(m => m[1]);
  r.ok(rows.length === 80, '抽到 4 关 × 20 行关卡数据', String(rows.length));
  const widths = new Set(rows.map(s => s.length));
  r.ok(widths.size === 1, '所有关卡行宽一致', [...widths].join('/'));

  // 按 20 行一关切开，逐关解析
  let allParsed = true, spawnsOk = true, goalsOk = true;
  for (let i = 0; i < 4; i++) {
    const chunk = rows.slice(i * 20, i * 20 + 20);
    try {
      const lv = C.parseLevel(chunk);
      // 出生点必须站在实地上，否则一开局就掉进坑里。
      // 脚底那一格就是玩家所站的行：y + 身高，除瓦片尺寸即是。
      const col = Math.floor(lv.spawn.x / C.TILE);
      const row = Math.floor((lv.spawn.y + 14) / C.TILE);
      if (C.tileAt(lv, col, row) !== C.SOLID) spawnsOk = false;
      if (!lv.goal) goalsOk = false;
    } catch (e) { allParsed = false; }
  }
  r.ok(allParsed, '四个内置关卡全部能解析');
  r.ok(spawnsOk, '四个关卡的出生点都站在实地上（不会一开局就掉坑）');
  r.ok(goalsOk, '四个关卡都有终点');
}

r.group('平台跳跃 · 轴分离碰撞');
{
  const C = evalCore('platformer');
  const T = C.TILE;
  // G 在解析时映射为"空"，所以在关卡里加一个终点不会改变地形 ——
  // 碰撞测试用的 fixture 也必须带上 G，因为 parseLevel 现在要求关卡
  // 必须有起点和终点，否则报错（这是刻意的：缺任何一样都不是合法关卡）。
  const lv = C.parseLevel([
    '#######',
    '#.P...#',
    '#.G...#',
    '#######',
  ]);

  // 向右撞墙：x 被贴到墙内侧，y 不动
  // 盒子右边缘在 91，墙（第 6 列）从 x=96 开始 —— 移动量必须真正跨过
  // 这条边界才会碰撞。第一版只移动 5px（右边缘落在 96），恰好停在
  // 边界上判不到，断言因此失败。测试里的几何量得算清楚。
  const a = { x: T * 5, y: T * 1 + 2, w: 11, h: 14 };
  const rightEdge = a.x + a.w;
  r.ok(rightEdge < T * 6, '起始时右边缘在墙的左侧', String(rightEdge));
  const hitR = C.moveX(a, lv, 8);
  r.ok(hitR === true, '向右撞墙返回 true');
  r.ok(a.x + a.w <= T * 6 + 1e-6, '撞墙后右边缘不超过墙', String(a.x));
  r.ok(Math.abs(a.y - (T + 2)) < 1e-9, 'moveX 不影响 y');

  // 向左撞墙
  const b = { x: T * 1 + 2, y: T + 2, w: 11, h: 14 };
  r.ok(C.moveX(b, lv, -8) === true, '向左撞墙返回 true');
  r.ok(Math.abs(b.x - T) < 1e-6, '被贴到左墙内侧', String(b.x));

  // 自由移动不触发碰撞
  const c = { x: T * 2, y: T + 2, w: 11, h: 14 };
  r.ok(C.moveX(c, lv, 3) === false, '自由移动不报碰撞');

  // 向下落地
  const d = { x: T * 2, y: T, w: 11, h: 14 };
  const hitD = C.moveY(d, lv, 20, d.y + d.h);
  r.ok(hitD === 'floor', '向下落到地面返回 floor', String(hitD));
  r.ok(Math.abs(d.y + d.h - T * 3) < 1e-6, '脚底贴地', String(d.y + d.h));
  r.ok(Math.abs(d.y - (T * 3 - 14)) < 1e-6, 'y 被修正到正确位置');

  // 向上撞天花板
  const e = { x: T * 2, y: T + 4, w: 11, h: 14 };
  r.ok(C.moveY(e, lv, -12, e.y + e.h) === 'ceil', '向上撞顶返回 ceil');
  r.ok(Math.abs(e.y - T) < 1e-6, '被贴到天花板下方');

  // 自由下落
  const f = { x: T * 2, y: T + 2, w: 11, h: 14 };
  r.ok(C.moveY(f, lv, 4, f.y + f.h) === false, '自由下落不报碰撞');
}

r.group('平台跳跃 · 单向平台（半砖最容易做错的地方）');
{
  const C = evalCore('platformer');
  const T = C.TILE;
  const lv = C.parseLevel([
    '#######',
    '#.P...#',
    '#=====#',
    '#.....#',
    '#..G..#',
    '#######',
  ]);
  const PLATFORM_TOP = 2 * T;      // 单向平台所在行的顶面 y

  /* 起始位置必须严格在平台顶面之上。
     第一版测试把盒子摆在了 y=T+4（脚底 34），而平台顶面在 32 ——
     盒子一开始就已经陷在平台里，于是"从上方落下"这个前提根本不成立，
     prevBottom <= 平台顶 的判定自然为假。那是测试摆错了场景，
     不是碰撞逻辑有问题。 */
  const fromAbove = { x: T * 2, y: PLATFORM_TOP - 14 - 6, w: 11, h: 14 };
  r.ok(fromAbove.y + fromAbove.h < PLATFORM_TOP, '起始位置确实在平台之上',
       '脚底 ' + (fromAbove.y + fromAbove.h) + ' < 平台顶 ' + PLATFORM_TOP);
  const prevBottom = fromAbove.y + fromAbove.h;
  const res = C.moveY(fromAbove, lv, 10, prevBottom);
  r.ok(res === 'floor', '从上方落下踩住单向平台', String(res));
  r.ok(Math.abs(fromAbove.y + fromAbove.h - PLATFORM_TOP) < 1e-6, '脚底贴住平台顶面',
       String(fromAbove.y + fromAbove.h));

  // 从下方上升：应该穿过，不能被挡
  const fromBelow = { x: T * 2, y: T * 3, w: 11, h: 14 };
  const prevB2 = fromBelow.y + fromBelow.h;
  const res2 = C.moveY(fromBelow, lv, -20, prevB2);
  r.ok(res2 === false, '从下方上升时穿过单向平台，不被挡住', String(res2));

  // 脚底已经在平台下方平面下、但这次是向上移动 → 不碰撞
  const deep = { x: T * 2, y: PLATFORM_TOP + 1, w: 11, h: 14 };
  const res3 = C.moveY(deep, lv, -6, deep.y + deep.h);
  r.ok(res3 === false, '上升穿过平台内部时不被吸附', String(res3));

  // 站在平台上之后再下一帧，仍然要踩得住（不能穿透）
  const resting = { x: T * 2, y: PLATFORM_TOP - 14, w: 11, h: 14 };
  const res4 = C.moveY(resting, lv, 1.5, resting.y + resting.h);
  r.ok(res4 === 'floor', '站在平台上时下一帧不会漏下去', String(res4));
  r.ok(Math.abs(resting.y + resting.h - PLATFORM_TOP) < 1e-6, '仍被贴回平台顶面');

  // 实心砖从下方必须挡住
  const solid = { x: T * 2, y: T * 3, w: 11, h: 14 };
  r.ok(C.moveY(solid, lv, -40, solid.y + solid.h) === 'ceil', '实心砖从下方会挡住');
}

r.group('平台跳跃 · 移动平台与跳跃参数');
{
  const C = evalCore('platformer');

  const m = { x: 200, y: 100, w: 48, h: 8, axis: 'x', range: 50, speed: 1, phase: 0 };
  let minX = Infinity, maxX = -Infinity;
  for (let t = 0; t < 100; t += 0.01) {
    const p = C.moverPos(m, t);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
  }
  r.ok(Math.abs(minX - 150) < 0.01 && Math.abs(maxX - 250) < 0.01,
       '水平平台的位移范围等于 x ± range',
       minX.toFixed(2) + '..' + maxX.toFixed(2));

  const mv = { x: 200, y: 100, w: 48, h: 8, axis: 'y', range: 30, speed: 1, phase: 0 };
  let minY = Infinity, maxY = -Infinity;
  for (let t = 0; t < 100; t += 0.01) {
    const p = C.moverPos(mv, t);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    if (p.x !== 200) { r.ok(false, '垂直平台不该改变 x'); break; }
  }
  r.ok(Math.abs(minY - 70) < 0.01 && Math.abs(maxY - 130) < 0.01,
       '垂直平台的位移范围等于 y ± range', minY.toFixed(2) + '..' + maxY.toFixed(2));

  // 位置由时间函数决定 → 同一个 t 必然得到同一个位置
  r.ok(C.moverPos(m, 3.7).x === C.moverPos(m, 3.7).x, '平台位置由时间决定，可重复');

  // 跳跃截断
  r.ok(C.cutJump(-400, 0.42) === -168, '上升速度按下落被截断');
  r.ok(C.cutJump(200, 0.42) === 200, '下落速度不受截断影响');

  // 指数平滑
  const v = C.approach(0, 100, 10, 1);
  r.ok(v > 0 && v < 100, '平滑逼近落在两端之间', v.toFixed(2));
  r.ok(Math.abs(C.approach(0, 100, 10, 1) - C.approach(0, 100, 10, 1)) < 1e-12, '平滑结果可重复');
}

/* ==================================================================
   推箱子
   ================================================================== */
r.group('推箱子 · 解析与不可变移动');
{
  const C = evalCore('sokoban');

  const s = C.parseLevel([
    '#####',
    '#@$.#',
    '#  $#',
    '#####',
  ]);
  r.ok(s.px === 1 && s.py === 1, '玩家位置解析正确');
  r.ok(s.boxes.size === 2, '两个箱子', String(s.boxes.size));
  r.ok(s.goals.size === 1, '一个目标点', String(s.goals.size));
  r.ok(C.isWall(s, 0, 0) && !C.isWall(s, 3, 1), '墙判定正确');

  // 玩家向右推箱子
  const n1 = C.tryMove(s, 1, 0);
  r.ok(n1 !== null, '可以推箱子');
  r.ok(n1.pushes === 1 && n1.moves === 1, '推动计数 +1');
  r.ok(s.pushes === 0, '原状态不被修改（不可变）');
  r.ok(s.boxes.has('2,1'), '原状态的箱子还在原处');
  r.ok(n1.boxes.has('3,1') && !n1.boxes.has('2,1'), '箱子被移动到新位置');
  r.ok(!C.isSolved(n1), '还有箱子没到位时不算解开');

  /* 再推一次会撞墙：箱子在 (3,1)，后面 (4,1) 是 '#'。
     第一版测试以为这里应该成功，还顺手把返回值（此时是 null）传给了
     isSolved —— 结果是一个断言失败 + 一个 TypeError。
     正确行为就是返回 null，调用方必须先判空。 */
  const n2 = C.tryMove(n1, 1, 0);
  r.ok(n2 === null, '把箱子推向墙壁 → 返回 null');
  r.ok(n1.boxes.has('3,1'), '失败的操作不产生任何副作用');

  // 单箱单目标的完整解法
  const simple = C.parseLevel(['#####', '#@$.#', '#####']);
  const after = C.tryMove(simple, 1, 0);
  r.ok(after !== null && C.isSolved(after), '把唯一箱子推上目标点即解开');
  r.ok(after.pushes === 1, '用了 1 次推动');

  // 两个箱子相邻时推不动
  const t = C.parseLevel([
    '######',
    '#@$$ #',
    '######',
  ]);
  r.ok(C.tryMove(t, 1, 0) === null, '前面是箱子、箱子后面还是箱子 → 推不动');

  // 往墙上走
  const w = C.parseLevel(['###', '#@#', '###']);
  r.ok(C.tryMove(w, 1, 0) === null, '往墙上走返回 null');
  r.ok(C.tryMove(w, 0, -1) === null, '往上墙走返回 null');

  // 空地上的移动应该成功且只增加步数
  const open = C.parseLevel(['#####', '#@  #', '#####']);
  const step = C.tryMove(open, 1, 0);
  r.ok(step.moves === 1 && step.pushes === 0, '空地上移动只加步数不加推动数');
}

r.group('推箱子 · 死角检测');
{
  const C = evalCore('sokoban');

  // 箱子在墙角（非目标点）→ 死局
  const corner = C.parseLevel([
    '#####',
    '#$  #',
    '#  .#',
    '#@  #',
    '#####',
  ]);
  r.ok(C.isDeadlocked(corner), '箱子被推进墙角时判定为死局');

  // 箱子在目标点上 → 不算死局
  const onGoal = C.parseLevel([
    '#####',
    '#*  #',
    '#  .#',
    '#@  #',
    '#####',
  ]);
  r.ok(!C.isDeadlocked(onGoal), '已在目标点上的箱子不算死局');

  // 开阔地 → 不是死局
  const open = C.parseLevel([
    '#####',
    '#   #',
    '# $ #',
    '#@ .#',
    '#####',
  ]);
  r.ok(!C.isDeadlocked(open), '开阔地里的箱子不是死局');
}

r.group('推箱子 · 用 BFS 求解器证明六关全部可解 ★');
{
  const C = evalCore('sokoban');

  // 从游戏源码里取出关卡数据
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../games/sokoban.html', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('const LEVELS = ['), src.indexOf('const cvs ='));
  const levels = [];
  let cur = null;
  for (const line of block.split('\n')) {
    const t = line.trim();
    if (t === '[') { cur = []; continue; }
    if (t === '],' || t === ']') { if (cur) { levels.push(cur); cur = null; } continue; }
    const m = t.match(/^'([^']*)',?$/);
    if (m && cur) cur.push(m[1]);
  }

  r.ok(levels.length === 6, '从源码里解析出 6 个关卡', String(levels.length));

  /** 广度优先搜索。因为 tryMove 是纯函数，求解器不需要任何"反向操作"。 */
  function solve(rows, maxStates) {
    const limit = maxStates || 300000;
    const start = C.parseLevel(rows);
    if (C.isSolved(start)) return { solvable: true, path: '', visited: 0 };
    const seen = new Set([C.fingerprint(start)]);
    let frontier = [{ s: start, path: '' }];
    let visited = 0;
    const dirs = [['U', 0, -1], ['D', 0, 1], ['L', -1, 0], ['R', 1, 0]];

    while (frontier.length && visited < limit) {
      const next = [];
      for (const node of frontier) {
        visited++;
        for (const [ch, dx, dy] of dirs) {
          const n = C.tryMove(node.s, dx, dy);
          if (!n) continue;
          if (C.isSolved(n)) {
            return { solvable: true, path: node.path + ch, visited };
          }
          const fp = C.fingerprint(n);
          if (seen.has(fp)) continue;
          seen.add(fp);
          next.push({ s: n, path: node.path + ch });
        }
      }
      frontier = next;
    }
    return { solvable: false, path: null, visited };
  }

  const paths = [];
  for (let i = 0; i < levels.length; i++) {
    const res = solve(levels[i]);
    paths.push(res.path);
    r.ok(res.solvable, `第 ${i + 1} 关可解`,
         res.solvable ? `${res.path.length} 步 / 探索 ${res.visited} 状态`
                      : `搜索 ${res.visited} 个状态后无解`);
  }

  // 把解出来的路径记下来，供冒烟测试回放
  if (paths.every(Boolean)) {
    r.note('解法路径：' + paths.map((p, i) => `第${i + 1}关 ${p}`).join(' | '));
    fs.writeFileSync(new URL('./.solutions.json', import.meta.url),
                     JSON.stringify(paths), 'utf8');
  }

  // 顺带验证"每关至少一个箱子、至少一个目标"
  for (let i = 0; i < levels.length; i++) {
    const s = C.parseLevel(levels[i]);
    r.ok(s.boxes.size >= 1 && s.goals.size >= 1, `第 ${i + 1} 关有箱子也有目标`);
    r.ok(s.boxes.size === s.goals.size, `第 ${i + 1} 关箱子数等于目标数`,
         s.boxes.size + ' vs ' + s.goals.size);
  }
}

/* ==================================================================
   弹幕射击
   ================================================================== */
r.group('弹幕射击 · 弹幕模式是数据');
{
  const C = evalCore('shooter');

  // 环形：数量、速率一致、角度均匀
  const ring = C.patternRing(8, 100, 0);
  r.ok(ring.length === 8, '环形产生 8 发', String(ring.length));
  const mags = ring.map(v => Math.hypot(v.vx, v.vy));
  r.ok(mags.every(m => Math.abs(m - 100) < 1e-6), '环形每发速率相同');
  const angles = ring.map(v => Math.atan2(v.vy, v.vx));
  let even = true;
  for (let i = 1; i < angles.length; i++) {
    let d = angles[i] - angles[i - 1];
    while (d < 0) d += C.TAU;
    if (Math.abs(d - C.TAU / 8) > 1e-6) even = false;
  }
  r.ok(even, '环形角度均匀分布');

  // 相位只旋转整圈，不改变形状
  const ring2 = C.patternRing(8, 100, 0.7);
  r.ok(Math.abs(Math.hypot(ring2[0].vx, ring2[0].vy) - 100) < 1e-6, '相位不改变速率');

  // 直射：方向指向目标
  const aimed = C.patternAimed(0, 0, 100, 0, 50, 1)[0];
  r.ok(Math.abs(aimed.vx - 50) < 1e-6 && Math.abs(aimed.vy) < 1e-6, '直射方向正确（朝 +x）');
  const aimed2 = C.patternAimed(0, 0, 0, 100, 50, 1)[0];
  r.ok(Math.abs(aimed2.vy - 50) < 1e-6, '直射方向正确（朝 +y）');

  // 扇形：数量与对称
  const fan = C.patternAimed(0, 0, 100, 0, 100, 5, 0.8);
  r.ok(fan.length === 5, '扇形产生 5 发');
  const fanAngles = fan.map(v => Math.atan2(v.vy, v.vx));
  r.ok(Math.abs(fanAngles[0] + fanAngles[4]) < 1e-9, '扇形关于中心对称');
  r.ok(Math.abs(fanAngles[2]) < 1e-9, '扇形正中一发沿基准方向');
  r.ok(fan.every(v => Math.abs(Math.hypot(v.vx, v.vy) - 100) < 1e-6), '扇形每发速率相同');

  // 螺旋
  const sp = C.patternSpiral(3, 100, 1.2);
  r.ok(sp.length === 3, '螺旋 3 条臂产生 3 发');
  const spMag = sp.map(v => Math.hypot(v.vx, v.vy));
  r.ok(spMag.every(m => Math.abs(m - 100) < 1e-6), '螺旋每发速率相同');

  // 边界：count=0 / 1 / 负数都不能崩
  r.ok(C.patternAimed(0, 0, 1, 1, 10, 0).length === 1, 'count=0 时至少给 1 发，不返回空');
  r.ok(C.patternAimed(0, 0, 1, 1, 10, -5).length === 1, 'count 为负时也不返回空');
  r.ok(C.patternRing(0, 10, 0).length === 0, '环形 0 发返回空数组');
  r.ok(C.patternSpiral(0, 10, 0).length === 1, '螺旋臂数 0 时按 1 处理');
}

r.group('弹幕射击 · 出场计划与难度曲线');
{
  const C = evalCore('shooter');

  // 同种子必须同计划
  const p1 = C.wavePlan(3, C.makeRNG(42));
  const p2 = C.wavePlan(3, C.makeRNG(42));
  r.ok(JSON.stringify(p1) === JSON.stringify(p2), '同种子的出场计划完全一致');

  // 每 5 波是首领
  for (const w of [5, 10, 15]) {
    const p = C.wavePlan(w, C.makeRNG(1));
    r.ok(p.length === 1 && p[0].kind === 'boss', `第 ${w} 波是首领战`, JSON.stringify(p.map(x => x.kind)));
  }
  for (const w of [1, 2, 3, 4, 6]) {
    const p = C.wavePlan(w, C.makeRNG(1));
    r.ok(!p.some(x => x.kind === 'boss'), `第 ${w} 波不是首领战`);
  }

  // 出场位置在场地内
  let inBounds = true;
  for (let w = 1; w <= 12; w++) {
    for (const spec of C.wavePlan(w, C.makeRNG(w * 31))) {
      if (spec.x < 0 || spec.x > 640) inBounds = false;
    }
  }
  r.ok(inBounds, '所有出场位置都在场地宽度内');

  // 难度曲线：单调递增且有上限
  r.ok(C.difficulty(1) === 1, '第 1 波难度倍率为 1');
  let mono = true;
  for (let w = 2; w <= 20; w++) if (C.difficulty(w) < C.difficulty(w - 1)) mono = false;
  r.ok(mono, '难度随波次单调不减');
  r.ok(C.difficulty(999) === 2.4, '难度有硬上限', String(C.difficulty(999)));

  // 相邻波次的难度增幅要平滑 —— 跳崖式增长正是"新兵种同权出场"造成的
  let peak = 0;
  for (let w = 2; w <= 20; w++) {
    const mult = C.difficulty(w) / C.difficulty(w - 1) - 1;
    peak = Math.max(peak, mult);
  }
  r.ok(peak < 0.2, '相邻波次难度增幅平滑', '峰值 +' + (peak * 100).toFixed(1) + '%');

  // 新兵种的渐进登场
  let spinnerEarly = 0, spinnerLate = 0;
  for (let seed = 0; seed < 120; seed++) {
    const early = C.wavePlan(2, C.makeRNG(seed));
    if (early.some(x => x.kind === 'spinner')) spinnerEarly++;
    const late = C.wavePlan(8, C.makeRNG(seed));
    if (late.some(x => x.kind === 'spinner')) spinnerLate++;
  }
  r.ok(spinnerEarly === 0, '第 2 波不出现 spinner（渐进登场）', String(spinnerEarly));
  r.ok(spinnerLate > 60, '第 8 波 spinner 经常出现', spinnerLate + '/120');

  let turretEarly = 0;
  for (let seed = 0; seed < 120; seed++) {
    if (C.wavePlan(2, C.makeRNG(seed)).some(x => x.kind === 'turret')) turretEarly++;
  }
  r.ok(turretEarly === 0, '第 2 波也不出现 turret', String(turretEarly));
}

r.group('弹幕射击 · 碰撞与随机数');
{
  const C = evalCore('shooter');

  r.ok(C.circleHit(0, 0, 5, 8, 0, 5) === true, '距离 8、半径和 10 → 命中');
  r.ok(C.circleHit(0, 0, 5, 11, 0, 5) === false, '距离 11、半径和 10 → 不命中');
  r.ok(C.circleHit(0, 0, 5, 10, 0, 5) === true, '恰好相切算命中');
  r.ok(C.circleHit(0, 0, 5, 0, 0, 5) === true, '完全重合算命中');

  const a = C.makeRNG(2026), b = C.makeRNG(2026);
  let same = true;
  for (let i = 0; i < 300; i++) if (a() !== b()) same = false;
  r.ok(same, '射击游戏的随机数同样可复现');
}

/* ================================================================== */
process.exit(r.finish() ? 0 : 1);
