/**
 * smoke.test.mjs — 端到端冒烟测试
 *
 * 在 mock 环境里**真正执行游戏脚本**：主循环、事件、渲染都会发生。
 * 每个游戏都走一遍完整的链路（开局 → 操作 → 结算 → 重开），
 * 而不是只调几个孤立函数。
 *
 * 这里也是"五个游戏共用一套约定"的验证：内部分辨率、调试接口、
 * 状态机命名、渲染调用量级。
 *
 * 运行：node tests/smoke.test.mjs
 */

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadGame, GAMES } from './lib/load.mjs';
import { createReporter, createStorage } from './lib/env.mjs';
import * as env from './lib/env.mjs';

const r = createReporter('smoke —— 五个游戏的完整链路');
const T = 16;   // 平台跳跃的瓦片尺寸

/* ==================================================================
   通用约定：每个游戏都必须满足
   ================================================================== */
r.group('通用约定');
{
  for (const g of GAMES) {
    let game = null;
    try {
      game = loadGame(g.id, { env });
    } catch (e) {
      r.ok(false, `${g.id} 能加载`, e.message);
      continue;
    }

    r.ok(!!game.GAME, `${g.id} 暴露了 __GAME__ 调试接口`);
    r.ok(typeof game.GAME.state === 'function', `${g.id} 有 state()`);

    // 先开局再检查渲染：标题画面上本来就没有东西可画，
    // 直接在主菜单断言"渲染量级"会得到一个 0。
    game.env.key(' ');
    game.env.step(4);
    r.ok(game.env.rafCount > 0, `${g.id} 的 rAF 主循环在运行`, 'rAF ' + game.env.rafCount + ' 次');
    r.ok(game.env.drawCalls > 100, `${g.id} 渲染调用量级正常`, game.env.drawCalls + ' 次');
    r.ok((game.env.ctxCalls.fillRect || 0) > 50, `${g.id} 在用 fillRect 逐块绘制`,
         String(game.env.ctxCalls.fillRect || 0));

    // 没有 AudioContext 也不能崩 —— mock 环境故意不提供它
    r.ok(true, `${g.id} 在无音频环境下没有抛异常`);

    game.env.releaseAll();
  }
}

/* ==================================================================
   打砖块
   ================================================================== */
r.group('打砖块 · 开局、破砖、清关、掉命、重开');
{
  const g = loadGame('breakout', { env });
  const G = g.GAME;

  r.ok(G.state() === 'start', '初始状态是 start');
  r.ok(G.aliveBricks() === 0, 'start 时还没有砖块');

  g.env.key(' ');
  g.env.step(2);
  r.ok(G.state() === 'ready', '按空格进入 ready');
  r.ok(G.aliveBricks() === 36, '第 1 关有 36 块砖', String(G.aliveBricks()));
  r.ok(G.balls().length === 1, '有一颗待发的球');
  r.ok(G.balls()[0].stuck === true, 'ready 状态球贴在挡板上');

  g.env.key(' ');
  g.env.step(2);
  r.ok(G.state() === 'play', '再按空格发射，进入 play');
  r.ok(G.balls()[0].stuck === false, '球已经脱离挡板');
  r.ok(G.balls()[0].vy < 0, '球朝上飞', String(G.balls()[0].vy.toFixed(1)));

  // 让球自己打一会儿，应该能破砖
  const before = G.aliveBricks();
  g.env.step(600);
  r.ok(G.aliveBricks() < before, '球能打掉砖块',
       before + ' → ' + G.aliveBricks());
  r.ok(G.score() > 0, '破砖加分数', String(G.score()));

  /* 清关判定要独立于球的状态来验证。
     上面的 600 帧里球多半掉出去过，状态可能停在 ready 或 over ——
     先显式回到 play，再清空砖块，才是在测"清关"而不是在测巧合。 */
  G.start();
  g.env.step(2);
  g.env.key(' ');
  g.env.step(2);
  r.ok(G.state() === 'play', '重新开局并发射，回到 play', G.state());
  G.destroyAllBricks();
  g.env.step(3);
  r.ok(G.state() === 'clear', '清空砖块后进入 clear', G.state());
  r.ok(G.aliveBricks() === 0, '砖块确实清空了');

  g.env.key(' ');
  g.env.step(3);
  r.ok(G.level() === 1, '按空格进入第 2 关', String(G.level()));
  r.ok(G.state() === 'ready', '新关卡回到 ready', G.state());
  r.ok(G.aliveBricks() > 0, '第 2 关有砖块', String(G.aliveBricks()));

  // 掉命：把球挪到底部以下
  g.env.key(' ');
  g.env.step(2);
  const livesBefore = G.lives();
  G.placeBall(0, 320, 400, 0, 100);
  g.env.step(30);
  r.ok(G.lives() === livesBefore - 1, '球掉出底边扣一条命',
       livesBefore + ' → ' + G.lives());
  r.ok(G.state() === 'ready', '掉命后回到 ready 等待重新发射', G.state());

  // 掉光剩下的命 → 游戏结束
  let guard = 0;
  while (G.lives() > 0 && guard++ < 12) {
    if (G.state() !== 'play') { g.env.key(' '); g.env.step(2); }
    G.placeBall(0, 320, 400, 0, 100);
    g.env.step(30);
  }
  r.ok(G.state() === 'over', '命用光后进入 over', G.state());

  g.env.key(' ');
  g.env.step(3);
  r.ok(G.lives() === 3, '重开后命恢复为 3', String(G.lives()));
  r.ok(G.score() === 0, '重开后分数归零');

  // 道具系统
  r.ok(typeof G.effects === 'function', '有道具计时器');
  G.launch();
  g.env.step(5);
  const startX = G.paddle().x;
  g.env.keyDown('ArrowRight');
  g.env.step(40);
  g.env.keyUp('ArrowRight');
  r.ok(G.paddle().x > startX, '键盘能推动挡板', startX.toFixed(1) + ' → ' + G.paddle().x.toFixed(1));

  g.env.releaseAll();
}

/* ==================================================================
   贪吃蛇
   ================================================================== */
r.group('贪吃蛇 · 推进、吃食、转向、撞死、存档');
{
  const storage = createStorage();
  const g = loadGame('snake', { env, storage });
  const G = g.GAME;

  r.ok(G.state() === 'start', '初始状态是 start');
  g.env.key(' ');
  g.env.step(2);
  r.ok(G.state() === 'play', '按空格开局');
  r.ok(G.body().length === 3, '初始长度 3', String(G.body().length));

  // 定时推进：等足够时间让 tick 发生
  const head0 = { ...G.body()[0] };
  g.env.step(120);
  const head1 = G.body()[0];
  r.ok(head1.x !== head0.x || head1.y !== head0.y, '蛇在移动',
       JSON.stringify(head0) + ' → ' + JSON.stringify(head1));

  // 吃食物：把食物放到蛇头的正前方
  const h = G.body()[0];
  const lenBefore = G.body().length;
  G.placeFood(h.x + 1, h.y);
  G.tick();
  r.ok(G.body().length === lenBefore + 1, '吃一次食物长度恰好 +1',
       lenBefore + ' → ' + G.body().length);
  r.ok(G.score() === lenBefore + 1, '分数跟着长度走');

  // 食物不会生成在蛇身上
  const food = G.food();
  if (food) {
    const onSnake = G.body().some(c => c.x === food.x && c.y === food.y);
    r.ok(!onSnake, '新食物不在蛇身上');
  }

  // 转向：向上转
  G.turn('up');
  G.tick();
  r.ok(G.dir() === 'up', '转向生效', G.dir());

  // 反向无效
  G.turn('down');
  r.ok(G.queue().length === 0, '禁止 180° 掉头');

  // 撞墙
  G.setBody([[0, 5], [1, 5], [2, 5]], 'left');
  G.tick();
  r.ok(G.state() === 'dead', '撞墙判死', G.state());
  r.ok(G.best() >= lenBefore + 1, '最高分被记录', String(G.best()));

  // 存档真的写进了 localStorage
  const dumped = storage._dump();
  r.ok(dumped['snake.best'] != null, '最高分写进了 localStorage',
       JSON.stringify(dumped));

  // 重开
  g.env.key(' ');
  g.env.step(2);
  r.ok(G.state() === 'play', '按空格重开', G.state());
  r.ok(G.body().length === 3, '重开后长度回到 3');

  g.env.releaseAll();
}

r.group('贪吃蛇 · localStorage 不可用时必须降级而不是崩溃');
{
  const bad = createStorage({ failMode: true });
  let crashed = null;
  try {
    const g = loadGame('snake', { env, storage: bad });
    g.env.key(' ');
    g.env.step(60);
    const G = g.GAME;
    G.placeFood(G.body()[0].x + 1, G.body()[0].y);
    G.tick();
    g.env.step(10);
    r.ok(true, 'localStorage 抛异常时游戏照常运行');
    r.ok(typeof G.best() === 'number', '最高分降级到内存里', String(G.best()));
  } catch (e) {
    crashed = e;
    r.ok(false, 'localStorage 抛异常时游戏照常运行', e.message);
  }
  if (crashed) r.note('崩溃信息：' + crashed.message);
}

/* ==================================================================
   平台跳跃
   ================================================================== */
r.group('平台跳跃 · 物理、手感参数、金币、终点');
{
  const g = loadGame('platformer', { env });
  const G = g.GAME;

  r.ok(G.state() === 'start', '初始状态是 start');
  g.env.key(' ');
  g.env.step(3);
  r.ok(G.state() === 'play', '按空格开局');

  /* 从出生点一直往右跑是不行的 —— 第 1 关的出生点在 (5,18)，
     往右 10 格就是第 10-13 列的坑（上面那块单向平台在出生点上方，
     平跑是踩不到的），跑过去会掉下去。
     测移动要先用传送挪到一段开阔的实地上，把"能不能跑"和"能不能过坑"
     分开测 —— 混在一起时，失败信息会指向错误的方向。 */
  G.teleport(16, 18);
  G.setVelocity(0, 0);
  g.env.step(12);                       // 先落地站稳
  r.ok(G.player().grounded === true, '传送后落回地面', String(G.player().grounded));

  const p0 = { ...G.player() };         // 必须拷贝：player() 返回活引用
  r.ok(p0.y > 0 && p0.y < 360, '位置在画面内');

  // 向右跑
  G.setInput({ right: true });
  g.env.step(30);
  const p1 = { ...G.player() };
  r.ok(p1.x > p0.x, '按右键往右跑', p0.x.toFixed(0) + ' → ' + p1.x.toFixed(0));
  r.ok(Math.abs(p1.vx) > 100, '达到相当的奔跑速度', p1.vx.toFixed(0));

  /* 跳跃要原地跳。
     继续按住右键的话，90 帧（1.5 秒 × 168px/s ≈ 250px）足够冲进
     第 23-26 列的下一个坑里 —— 那样"跳完会落回地面"测的其实是
     "掉进坑里"，失败信息会指向完全无关的地方。 */
  G.setInput({ right: false });
  g.env.step(24);                       // 先减速停稳
  const yBefore = G.player().y;
  G.requestJump();
  g.env.step(12);
  r.ok(G.player().y < yBefore, '跳跃让角色升高',
       yBefore.toFixed(0) + ' → ' + G.player().y.toFixed(0));

  // 落地
  g.env.step(90);
  r.ok(G.player().grounded === true, '跳完会落回地面', String(G.player().grounded));

  // 撞墙不能穿过去
  G.teleport(1, 16);
  G.setVelocity(0, 0);
  g.env.step(5);
  G.setInput({ right: false });
  g.env.step(30);
  r.ok(G.player().x >= 0, '玩家不会跑出左边界', G.player().x.toFixed(1));

  /* 掉进坑里会死。
     这里有两条教训，都是测试自己写错、不是游戏的问题：
       1. 别用活引用做快照（见上面 p0 那处）；
       2. 传送位置要先看清地形 —— 第一版传送到第 11 列，那一列
          正好有第 17 行的单向平台横跨，于是"坑"是有盖的，永远掉不下去。
          而且必须先显式 loadLevel(0)，否则此时关卡可能已经被前面的
          测试推进到第 2 关，地形完全不同。 */
  G.loadLevel(0);
  g.env.step(3);
  r.ok(G.levelIndex() === 0, '回到第 1 关再测坠落');
  const deaths0 = G.deaths();
  G.teleport(24, 8);          // 第 1 关第 23-26 列是没有任何遮挡的坑
  G.setVelocity(0, 200);
  g.env.step(200);
  r.ok(G.deaths() > deaths0, '掉出关卡会记录死亡', deaths0 + ' → ' + G.deaths());
  g.env.step(90);
  r.ok(G.player().grounded === true, '死亡后自动重生并站稳');

  // 金币
  const coins0 = G.coins();
  const lv = G.level();
  const coin = lv.coins.find(c => !c.taken);
  if (coin) {
    G.teleport(Math.floor(coin.x / T), Math.floor(coin.y / T));
    G.setVelocity(0, 0);
    g.env.step(4);
    r.ok(G.coins() > coins0, '走到金币上会拾取', coins0 + ' → ' + G.coins());
  } else {
    r.ok(false, '关卡里应该有可拾取的金币');
  }

  // 终点：直接传送到终点位置
  const goal = G.level().goal;
  G.teleport(Math.floor(goal.x / T), Math.floor(goal.y / T));
  G.setVelocity(0, 0);
  g.env.step(4);
  r.ok(G.state() === 'clear' || G.state() === 'win', '碰到终点进入结算', G.state());

  g.env.releaseAll();
}

r.group('平台跳跃 · 自动驾驶通关（用真实物理验证关卡设计）★');
{
  /* 这一条是"关卡能不能打通"的机器验证。它不靠传送，而是用一个
     只做三件事的自动驾驶：一直往右跑、前方有坑/有墙/有刺就跳、
     跳过以后松手落下来。

     它同时验证三件事：关卡地形可通行、物理参数够用（跳得够高够远）、
     终点确实能被触发。改成坏关卡或调低跳跃力，这一条立刻变红。

     关键在"前方有没有地"的判定方式：**向下搜索若干行**，而不是只看脚下那一行。
     只看一行的话，站在单向平台上时会把下方的实地误判成悬空，
     于是无谓地起跳，落点完全失控。 */
  const solidLike = t => t === 1 || t === 2;   // SOLID 或 ONEWAY

  function autoplay(levelIndex, maxFrames) {
    const g = loadGame('platformer', { env });
    const G = g.GAME;
    g.env.key(' ');
    g.env.step(2);
    G.loadLevel(levelIndex);
    g.env.step(2);

    const lvRows = G.level().rows;
    const lvCols = G.level().cols;
    const hasGround = (col, fromRow) => {
      if (col < 0 || col >= lvCols) return true;     // 边界当作有地
      for (let rr = fromRow; rr < lvRows; rr++) if (solidLike(G.tileAt(col, rr))) return true;
      return false;
    };

    let jumpHold = 0;
    let frames = 0;
    let deaths = 0;
    let prevState = G.state();
    let reached = false;

    while (frames < maxFrames) {
      const p = G.player();
      const feetRow = Math.floor((p.y + p.h + 1) / T);
      const midCol = Math.floor((p.x + p.w / 2) / T);
      const aheadCol = midCol + 1;

      const groundAhead = hasGround(aheadCol, feetRow) || hasGround(aheadCol + 1, feetRow);
      const wallAhead = G.solidAt(aheadCol, feetRow - 1) || G.solidAt(aheadCol, feetRow - 2);
      // 尖刺长在玩家身体所在的那一行（地面之上），即 feetRow - 1
      const spikeAhead = G.tileAt(aheadCol, feetRow - 1) === 3 ||
                         G.tileAt(aheadCol + 1, feetRow - 1) === 3;

      G.setInput({ right: true, left: false });
      if (p.grounded && (!groundAhead || wallAhead || spikeAhead) && jumpHold === 0) {
        G.requestJump();
        jumpHold = 16;                 // 按住足够久，拿到接近满跳的高度
      }
      if (jumpHold > 0) { G.setInput({ right: true, jumpHeld: true }); jumpHold--; }
      else G.setInput({ jumpHeld: false });

      g.env.step(1);
      frames++;

      const st = G.state();
      // 计数要认"进入 dead 的那一次跃迁"，而不是每一帧都数一遍
      if (st === 'dead' && prevState !== 'dead') deaths++;
      prevState = st;

      if (st === 'clear' || st === 'win') { reached = true; break; }
    }

    g.env.releaseAll();
    return { reached, frames, deaths };
  }

  let totalFrames = 0, totalDeaths = 0;
  for (let li = 0; li < 4; li++) {
    const res = autoplay(li, 2400);
    totalFrames += res.frames;
    totalDeaths += res.deaths;
    r.ok(res.reached, `第 ${li + 1} 关能被自动驾驶打通`,
         res.reached
           ? `${res.frames} 帧（约 ${(res.frames / 60).toFixed(1)} 秒），死亡 ${res.deaths} 次`
           : `2400 帧内没有抵达终点，死亡 ${res.deaths} 次`);
  }
  r.note(`四关合计 ${totalFrames} 帧（约 ${(totalFrames / 60).toFixed(1)} 秒），共死亡 ${totalDeaths} 次`);
  r.ok(totalDeaths === 0, '自动驾驶全程零死亡（说明关卡没有"勉强能过"的地方）',
       '死亡 ' + totalDeaths + ' 次');
}

/* ==================================================================
   推箱子
   ================================================================== */
r.group('推箱子 · 回放求解器给出的解法 ★');
{
  const solutionsFile = new URL('./.solutions.json', import.meta.url);
  let paths = null;

  /* 解法文件由 core.test.mjs 生成（它才持有 BFS 求解器）。
     单独运行本文件时它可能还不存在 —— 自动把 core 跑一遍，
     而不是让使用者去猜"为什么只跑 smoke 会失败"。 */
  if (!fs.existsSync(solutionsFile)) {
    r.note('解法文件不存在，先运行 core.test.mjs 生成…');
    spawnSync(process.execPath, [fileURLToPath(new URL('./core.test.mjs', import.meta.url))],
              { encoding: 'utf8', timeout: 180000 });
  }

  try {
    paths = JSON.parse(fs.readFileSync(solutionsFile, 'utf8'));
  } catch (e) {
    r.ok(false, '能读到 core 测试导出的解法文件', e.message);
  }

  if (paths) {
    r.ok(paths.length === 6, '六关都有解法', String(paths.length));

    for (let i = 0; i < Math.min(6, paths.length); i++) {
      const g = loadGame('sokoban', { env });
      const G = g.GAME;
      g.env.key(' ');
      g.env.step(2);
      G.loadLevel(i);
      g.env.step(2);

      r.ok(G.levelIndex() === i, `载入第 ${i + 1} 关`);
      const boxesBefore = G.boxes().length;

      const applied = G.applyMoves(paths[i]);
      g.env.step(4);

      r.ok(applied === paths[i].length, `第 ${i + 1} 关的解法每一步都合法`,
           `${applied}/${paths[i].length}`);
      r.ok(G.isSolved(), `第 ${i + 1} 关按解法走完确实解开`,
           '箱子 ' + boxesBefore + ' 个，到位 ' + G.boxesOnGoal() + ' 个');
      r.ok(G.state() === 'solved' || G.state() === 'clear' || G.state() === 'win',
           `第 ${i + 1} 关解开后状态正确`, G.state());

      // 结算面板出现后可以进入下一关
      if (G.state() === 'solved') {
        g.env.step(40);
        r.ok(G.state() === 'clear' || G.state() === 'win',
             `第 ${i + 1} 关结算面板正常弹出`, G.state());
      }
    }
  }
}

r.group('推箱子 · 撤销、重来、死角提示');
{
  const g = loadGame('sokoban', { env });
  const G = g.GAME;
  g.env.key(' ');
  g.env.step(2);
  G.loadLevel(2);
  g.env.step(2);

  const startPos = { ...G.playerPos() };
  r.ok(G.undoDepth() === 0, '开局时撤销栈是空的');

  G.move(1, 0);
  g.env.step(2);
  r.ok(G.playerPos().x !== startPos.x, '向右移动生效');
  r.ok(G.undoDepth() === 1, '撤销栈 +1', String(G.undoDepth()));
  r.ok(G.moves() === 1, '步数 +1');

  const afterMove = { ...G.playerPos() };
  G.undo();
  g.env.step(2);
  const pos = G.playerPos();
  r.ok(pos.x === startPos.x && pos.y === startPos.y, '撤销回到原位',
       JSON.stringify(afterMove) + ' → ' + JSON.stringify(pos));
  r.ok(G.undoDepth() === 0, '撤销后栈清空');

  // 撤销栈空了再撤销不能崩
  G.undo();
  G.undo();
  g.env.step(2);
  r.ok(true, '栈空时继续撤销不会崩溃');

  // 重来
  G.move(1, 0); G.move(0, 1);
  G.restart();
  g.env.step(2);
  r.ok(G.moves() === 0, '重来后步数归零');
  r.ok(G.playerPos().x === startPos.x, '重来后回到初始位置');

  // 死角：把箱子推进角落
  G.loadLevel(6);
  g.env.step(2);
  // 第 6 关里把中间那个箱子往左推到墙角
  G.applyMoves('L');
  g.env.step(4);
  r.ok(typeof G.isDeadlocked() === 'boolean', '死角检测可用', String(G.isDeadlocked()));

  g.env.releaseAll();
}

/* ==================================================================
   弹幕射击
   ================================================================== */
r.group('弹幕射击 · 波次、开火、命中、受击、首领');
{
  const g = loadGame('shooter', { env });
  const G = g.GAME;

  r.ok(G.state() === 'start', '初始状态是 start');
  g.env.key(' ');
  g.env.step(2);
  r.ok(G.state() === 'play', '按空格开局');
  r.ok(G.wave() === 1, '从第 1 波开始');

  /* 关键：必须重新用固定种子开局。
     游戏默认用 Date.now() 当种子（每局都不同，这是对的设计），
     但测试里不钉住种子的话，同一份代码两次跑会得到不同结果 ——
     表现就是"这次过了下次没过"的不稳定断言。
     本项目就在这里踩过一次：子弹计数那条断言时红时绿，
     根因是某一波恰好在统计窗口内结束、把计数器清零了。 */
  G.start(31337);
  g.env.step(2);
  r.ok(G.wave() === 1, '用固定种子重新开局', String(G.seed()));

  // 敌人会出场
  // 先给玩家一个很长的无敌时间：这个测试要看的是"波次能不能推进"，
  // 而自动驾驶不会闪避 —— 不设无敌的话玩家会在 700 帧内被打死三次，
  // 状态变成 over，波次推进的断言就永远测不到。测什么就把它保护起来。
  G.player().invuln = 1e6;
  g.env.step(700);
  r.ok(G.enemies().length > 0 || G.spawnQueue().length > 0, '敌人开始出场',
       '场上 ' + G.enemies().length + ' 个，待出场 ' + G.spawnQueue().length);
  r.ok(G.state() === 'play', '全程保持存活（无敌中）', G.state());

  // 开火
  g.env.keyDown(' ');
  g.env.step(40);
  r.ok(G.pbullets().length > 0, '按住空格会发射子弹', String(G.pbullets().length));

  // 敌方子弹：等敌人开火
  let ebulletsSeen = 0;
  for (let i = 0; i < 40; i++) {
    g.env.step(30);
    ebulletsSeen = Math.max(ebulletsSeen, G.ebullets().length);
    if (ebulletsSeen > 0) break;
  }
  r.ok(ebulletsSeen > 0, '敌人会发射子弹', '峰值 ' + ebulletsSeen + ' 发');
  r.ok(G.bulletCount() > 0, '子弹发射计数在累加', String(G.bulletCount()));

  // 击毁敌人
  const before = G.enemies().length;
  for (let i = 0; i < G.enemies().length; i++) G.damageEnemy(i, 999);
  g.env.step(20);
  r.ok(G.enemies().length < before, '敌人能被击毁', before + ' → ' + G.enemies().length);
  r.ok(G.score() > 0, '击毁敌人有分数', String(G.score()));
  r.ok(G.particles().length > 0, '击毁时产生粒子', String(G.particles().length));

  /* 清场 → 进入下一波。
     要同时清掉"场上敌人"和"还没出场的队列" —— 前面的 700 帧里
     第 1 波早就打完了、第 2 波正在陆续出场，只清场上那几只的话
     队列里还有没排到的，永远不会判定为"清场完成"。 */
  const wave0 = G.wave();
  G.clearWave();
  g.env.step(30);
  r.ok(G.wave() > wave0, '清场后进入下一波', wave0 + ' → ' + G.wave());
  r.ok(G.spawnQueue().length > 0 || G.enemies().length > 0,
       '新波次的出场计划已经就位');

  // 受击扣命（先把刚才的无敌保护撤掉）
  G.clearBullets();
  G.player().invuln = 0;
  const lives0 = G.lives();
  G.hurt();
  g.env.step(2);
  r.ok(G.lives() === lives0 - 1, '受击扣一条命', lives0 + ' → ' + G.lives());

  // 无敌帧：紧接着再受击不该再扣
  const lives1 = G.lives();
  G.hurt();
  g.env.step(2);
  r.ok(G.lives() === lives1, '无敌帧内再受击不扣命');

  // 掉光命 → 结束
  let guard = 0;
  while (G.lives() > 0 && guard++ < 10) {
    G.player().invuln = 0;
    G.hurt();
    g.env.step(2);
  }
  r.ok(G.state() === 'over', '命用光后进入 over', G.state());

  g.env.keyUp(' ');
  g.env.key(' ');
  g.env.step(3);
  r.ok(G.lives() === 3, '重开后命恢复', String(G.lives()));
  r.ok(G.score() === 0, '重开后分数归零');

  g.env.releaseAll();
}

r.group('弹幕射击 · 首领波次与弹幕规模');
{
  const g = loadGame('shooter', { env });
  const G = g.GAME;
  g.env.key(' ');
  g.env.step(2);

  // 直接跳到第 5 波（首领）
  G.nextWave(); G.nextWave(); G.nextWave(); G.nextWave();
  G.clearEnemies();
  g.env.step(200);

  r.ok(G.wave() === 5, '跳到第 5 波', String(G.wave()));
  const boss = G.enemies().find(e => e.kind === 'boss');
  r.ok(!!boss, '第 5 波出现首领',
       G.enemies().map(e => e.kind).join(',') || '(无)');
  if (boss) {
    r.ok(boss.hp > 80, '首领血量远高于普通敌人', String(boss.hp));
    r.ok(boss.r > 20, '首领体型更大', String(boss.r));
  }

  // 首领的弹幕量级
  G.clearBullets();
  g.env.step(300);
  r.ok(G.bulletCount() > 10, '首领发射了大量子弹（三种模式轮转）',
       String(G.bulletCount()));
  r.ok(G.ebullets().length <= 900, '子弹数量不超过硬上限',
       String(G.ebullets().length));

  g.env.releaseAll();
}

/* ==================================================================
   隔离性：多个实例之间不能互相污染
   ================================================================== */
r.group('隔离性');
{
  // 同时开两个贪吃蛇，各自独立推进，互不影响
  const a = loadGame('snake', { env });
  const b = loadGame('snake', { env });
  a.env.key(' '); a.env.step(2);
  b.env.key(' '); b.env.step(2);

  a.GAME.tick(); a.GAME.tick(); a.GAME.tick();

  const aHead = JSON.stringify(a.GAME.body()[0]);
  const bHead = JSON.stringify(b.GAME.body()[0]);
  r.ok(aHead !== bHead, '两个实例的推进互不影响',
       'A 头 ' + aHead + ' / B 头 ' + bHead);

  // 一个实例崩溃不该影响另一个
  a.env.releaseAll();
  b.env.step(5);
  r.ok(b.GAME.state() === 'play', '另一个实例继续正常运行');

  // mock 环境的 getElementById 会自动造元素 —— 这正是必须配静态检查的原因
  const ghost = a.env.getEl('this-id-does-not-exist');
  r.ok(!!ghost, 'mock 环境会自动创建任何 id（所以需要 dom-check.mjs 兜底）');
}

/* ================================================================== */
process.exit(r.finish() ? 0 : 1);
