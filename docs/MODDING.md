# 改造指南

按「我想做什么」组织。每条都写明：**改哪里、怎么改、有什么副作用**。

先读一遍 [ANATOMY.md](ANATOMY.md) 会顺很多 —— 下面反复提到「调参区」「算法区」「游戏层」。

> 改完记得跑 `npm test`。四套测试里有几条专门盯着关卡数据和手感参数，改坏了会立刻变红。

---

## 目录

- [1. 加一个关卡](#1-加一个关卡)
- [2. 换成我自己的配色](#2-换成我自己的配色)
- [3. 改手感](#3-改手感)
- [4. 换掉所有美术](#4-换掉所有美术)
- [5. 加一个新道具 / 新敌人](#5-加一个新道具--新敌人)
- [6. 加一个新游戏机制](#6-加一个新游戏机制)
- [7. 改成一关更长 / 有记录点](#7-改成一关更长--有记录点)
- [8. 加音效 / 换音效](#8-加音效--换音效)
- [9. 加个"最高分"存档](#9-加个最高分存档)
- [10. 适配手机触屏](#10-适配手机触屏)

---

## 1. 加一个关卡

### 打砖块

在 `#region CORE` 里找到 `LEVELS`，加一个字符串数组：

```js
const LEVELS = [
  // ... 已有的 5 关
  ['111111111111',
   '2.2.2.2.2.2.',
   '333333333333'],     // ← 新加的第 6 关
];
```

- 每行必须是 **12 个字符**（等于 `COLS`）
- 字符含义：`.` 空、`1`/`2`/`3` 是砖块耐久
- 行数不超过 `ROWS`（7 行），多余的会被忽略
- 超过 12 字符的部分也会被忽略 —— **不会被报错**，所以自己数清楚

改完运行 `node tests/core.test.mjs`，那里有一条断言检查所有关卡行宽一致。

### 推箱子

在 `LEVELS` 里加一组字符串：

```js
[
  '########',
  '#      #',
  '#  .$  #',
  '#  @   #',
  '########',
],
```

字符：`#` 墙、` ` 地板、`.` 目标、`$` 箱子、`*` 箱子已在目标上、`@` 玩家、`+` 玩家在目标上。

**加完必须验证可解**：

```bash
node tests/core.test.mjs
```

测试里的 BFS 求解器会把每一关都解一遍。如果无解，它会明确报出来 —— 这是这个项目最有价值的一条断言，因为**手写关卡无解是最常见的错误，而人眼看不出来**。

关卡会变大时求解可能变慢。测试里的状态上限是 30 万，超过会报「搜索 N 个状态后无解」——那说明要么真的无解，要么状态空间太大需要换更聪明的搜索。

### 平台跳跃

关卡数据分两部分：**地形**和**移动平台**。

```js
{
  name: '新关卡',
  rows: [
    '................................................',   // 每行必须 48 字符
    // ... 共 20 行
    '.....P.......................................G..',
    '#######.....##########.....##########.....######',
  ],
  movers: [
    { x: 144, y: 17 * 16, w: 32, h: 8, axis: 'x', range: 40, speed: 1.1, phase: 0 },
  ],
}
```

字符：`#` 实心、`=` 单向平台、`^` 尖刺、`o` 金币、`P` 出生、`G` 终点。

**两条硬约束**（都有测试盯着）：

- **`P` 和 `G` 必须有**。缺任何一个 `parseLevel` 会直接抛错 —— 这是刻意的，静默给个默认坐标只会让你在别处 debug 半天。
- **出生点必须站在实地上**。写在地面「之上」的坑上方，一开局就掉下去。

**缺口宽度不能超过一次跳跃的距离**（约 5.9 格）。超了就必须放移动平台，而且平台的 `y` 要在一次跳跃够得着的高度内（离地面不超过 61px）。

加完后跑 `node tests/smoke.test.mjs`，里面有一个自动驾驶会用真实物理把你的关卡跑一遍；`node tests/systems.test.mjs` 会检查缺口宽度和平台位置。

### 贪吃蛇 / 弹幕射击

这两个没有固定关卡。

- 贪吃蛇的「难度」是速度曲线，在调参区：`BASE_INTERVAL`（起始）和 `MIN_INTERVAL`（上限）
- 弹幕射击的「关卡」是波次计划，在算法区的 `wavePlan()` 里

---

## 2. 换成我自己的配色

每个文件的 `<style>` 开头都有一组 CSS 变量：

```css
:root{
  --bg:#0b0e14; --ink:#e8eef7; --dim:#7b8798;
  --c1:#4cc2ff; --c2:#ff5fa2; --c3:#ffc857; --hi:#8ef0c8;
}
```

**但 canvas 里的颜色是硬编码的**（`ctx.fillStyle = '#4cc2ff'`）—— CSS 变量管不到 canvas。

所以换配色要改两处：

1. `<style>` 里的 `:root`（影响 HUD、覆盖层、按钮）
2. 脚本里所有 `fillStyle`（影响游戏画面）

一次性改干净的办法：把颜色抽成脚本顶部的常量，然后在需要的地方引用。

以打砖块为例，在调参区上方加：

```js
const COLOR = {
  bg: '#0b0e14',
  paddle: '#e8eef7',
  ball: '#ffc857',
  brick1: ['#4cc2ff', '#8fdcff'],
  brick2: ['#ff5fa2', '#ffa8cc'],
  brick3: ['#ffc857', '#ffe9a8'],
};
```

然后把 `BRICK_COLOR` 换成引用 `COLOR`。这样以后换配色只动一处。

> **别改砖块颜色的「数组结构」**。`BRICK_COLOR[n]` 是 `[主色, 高光色]`，渲染代码按这个顺序取用。改成单个颜色字符串会静默产生 `undefined`，画面变白。

---

## 3. 改手感

手感参数集中在每个游戏调参区，改数字就行。但有些数字之间**有约束关系**。

### 平台跳跃

```js
const GRAVITY  = 1500;
const JUMP_V   = 428;      // 跳跃高度 = JUMP_V² / (2 × GRAVITY) ≈ 61px
const MAX_RUN  = 168;
const COYOTE   = 0.10;     // 离开地面后仍可起跳的宽限
const JUMP_BUFFER = 0.12;  // 落地前提前按跳的宽限
const JUMP_CUT = 0.42;     // 松手时保留的上升速度比例
```

**改完必须重新验证跳跃距离**：

```
水平跳跃距离 ≈ MAX_RUN × (2 × JUMP_V / GRAVITY)
             = 168 × 0.571 = 96px ≈ 6 格
```

关卡里的坑最宽 5 格（80px）。如果你把 `MAX_RUN` 调低到 140，距离变成 80px —— 刚好卡在临界，自动驾驶测试会开始变得不稳定。

想改跳跃手感又不破坏关卡，推荐这么调：

| 想要的感觉 | 怎么改 |
|---|---|
| 跳得更高更飘 | `JUMP_V` ↑ 同时 `GRAVITY` ↓（保持高度，只改滞空） |
| 跳得干脆利落 | `JUMP_V` ↑ 同时 `GRAVITY` ↑（滞空变短，落地更重） |
| 更宽容 | `COYOTE` 和 `JUMP_BUFFER` 都调到 0.15 |
| 更硬核 | 两个都调到 0.03，玩家必须精准操作 |

**`COYOTE` 和 `JUMP_BUFFER` 不要超过 0.2 秒**。太长的宽限会让玩家觉得「明明没按却跳了」，反而更难操作。

### 打砖块

```js
const BASE_SPEED = 214;
const SPEED_CAP  = 1.72;
const MAX_BOUNCE_ANGLE = 1.09;   // 约 62°
const DROP_CHANCE = 0.14;
```

- `MAX_BOUNCE_ANGLE` 调到 π/2（1.57）会让球接近水平飞，视觉上会卡在砖块之间反复横跳
- 建议不超过 1.2
- `SPEED_CAP` 超过 2.5 之后，球速会高到看不清轨迹

### 贪吃蛇

```js
const BASE_INTERVAL = 132;   // 起始每格毫秒
const MIN_INTERVAL  = 58;    // 速度上限
const PER_FOOD      = 2.6;   // 每吃一个减少的毫秒
```

`MIN_INTERVAL` 低于 45 就超出人类反应了。

### 弹幕射击

```js
const FIRE_CD = 0.135;       // 玩家射速
const HIT_R   = 2.5;         // 玩家判定半径（远小于外观）
const INVULN  = 1.4;         // 受击无敌时间
```

`HIT_R` 是弹幕游戏最关键的参数之一。**玩家看起来有 15px 宽，但判定只有 2.5px 半径** —— 这是行业惯例（「擦弹」的乐趣就是这么来的）。调到 7 会让游戏立刻变得非常难。

---

## 4. 换掉所有美术

目前的画面全部是 canvas 矩形绘制，没有贴图。换成真正的像素贴图有两种做法。

### 做法 A：继续用形状，但画得更细

以打砖块的球为例：

```js
// 现在是 4×4 方块
ctx.fillStyle = '#ffc857';
ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);

// 换成 8:8 的圆形点阵（更「像素画」）
const BALL_PIXELS = [
  [0,1,1,0],
  [1,1,1,1],
  [1,1,1,1],
  [0,1,1,0],
];
for (let py = 0; py < 4; py++) {
  for (let px = 0; px < 4; px++) {
    if (!BALL_PIXELS[py][px]) continue;
    ctx.fillRect(Math.round(b.x) - 2 + px, Math.round(b.y) - 2 + py, 1, 1);
  }
}
```

优点：仍是单文件、无外部资源。缺点：复杂图案写起来累。

### 做法 B：内嵌 base64 贴图

把 PNG 转成 base64 塞进 `<script>`：

```js
const SPRITE_SHEET = 'data:image/png;base64,iVBORw0KGgo...';
const sheet = new Image();
sheet.src = SPRITE_SHEET;

// 渲染时
ctx.drawImage(sheet, sx, sy, sw, sh, dx, dy, dw, dh);
```

注意两点：

1. **要等 `sheet.onload` 之后才能 drawImage**。在 load 之前画会得到空白。最省事的写法是在 `onload` 里才启动主循环。
2. **base64 会让文件变大 33%**。一张 4KB 的小贴图变成 5.5KB，可以接受；别塞大图。

`data:` 协议的图片**不算外部依赖**（不发起网络请求），所以静态检查不会拦它，离线也能跑。

### 做法 C：代码生成贴图

在启动时用离屏 canvas 画一遍，之后 `drawImage` 复用：

```js
function makeSprite(w, h, pixels, palette) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = pixels[y][x];
      if (v === 0) continue;
      g.fillStyle = palette[v];
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}
```

这是三者里最平衡的：贴图仍然写在代码里（可读、可 diff、可参数化），渲染时是 `drawImage`（快）。像素艺术模板常用这个路子。

---

## 5. 加一个新道具 / 新敌人

### 打砖块加一个道具

三个地方各加一行。

**第一步**：注册道具

```js
const DROPS = {
  wide:  { color: '#8ef0c8', label: 'W' },
  multi: { color: '#ffc857', label: 'M' },
  slow:  { color: '#4cc2ff', label: 'S' },
  laser: { color: '#ff5fa2', label: 'L' },   // ← 新增
};
```

**第二步**：实现效果

```js
function applyDrop(kind) {
  if (kind === 'wide') { ... }
  else if (kind === 'slow') { ... }
  else if (kind === 'multi') { ... }
  else if (kind === 'laser') {                 // ← 新增
    G.effects.laser = EFFECT_MS;
  }
  sfx(880, 0.09, 'triangle', 0.05);
}
```

**第三步**：让效果真的生效（**最容易漏的一步**）

如果这个道具是持续性的，还得在 `update()` 的计时循环里处理它的结束：

```js
for (const k of Object.keys(G.effects)) {
  if (G.effects[k] > 0) {
    G.effects[k] -= ms;
    if (G.effects[k] <= 0) {
      G.effects[k] = 0;
      if (k === 'wide') G.paddle.w = PADDLE_W;
      // laser 不需要收尾动作，所以这里不用加
    }
  }
}
```

**别忘了在 `G.effects` 里初始化它**（`effects: { wide: 0, slow: 0, laser: 0 }`）。用 `Object.keys` 遍历计时的写法要求所有道具都在这个对象里，漏了的话新道具永远不生效、而且不报错。

> 这一类「加了新东西但核心机制没跑起来」的缺陷，是本项目踩过最多的一类。加完新道具，**一定要真的打出来用一次**，别只看画面出现了图标。

### 弹幕射击加一个新敌人

**第一步**：定义数值

```js
const ENEMY_DEF = {
  // ... 已有的
  weaver: { hp: 4, r: 9, color: '#8ef0c8', score: 18, fireCd: 1.6, descend: 44 },
};
```

**第二步**：让它出现在波次里

在 `wavePlan()` 里加权重。**新兵种要渐进登场**：

```js
let weaverWeight = 0;
if (wave >= 8) weaverWeight = 0.3;
else if (wave >= 6) weaverWeight = 0.15;
```

为什么不一开始就满权重：新兵种一登场就和其他兵种同权，那一波的**平均强度会直接跳一截**。实测过，单层增幅会到 95% —— 玩家感受到的是「突然打不过了」，而不是「来了个新敌人」。调整分布比调整数值有效得多。

**第三步**：给它一个**与众不同的弹幕**

```js
} else if (e.kind === 'weaver') {
  emit(e.x, e.y, patternSpiral(3, 100, e.t * 2.6), 1);
}
```

**第四步**（重要）：确认它的弹幕形状和现有敌人不重复

`node tests/systems.test.mjs` 里有一条断言检查「三种弹幕的速率两两不同」。加了新敌人之后，如果它的弹幕速率和某个已有敌人一样，那条断言的设计意图就被破坏了 —— 它没有自己的辨识度，玩家区分不出来。

---

## 6. 加一个新游戏机制

举个例子：给平台跳跃加「二段跳」。

### 第一步：判断它属于哪一层

「能不能再跳一次」是规则，属于算法区吗？

**不属于**。算法区放的是纯计算（碰撞、解析、模式生成）。二段跳是状态管理，属于游戏层。但它依赖一个明确的判断：**还剩几次跳跃**。

### 第二步：加状态

```js
function respawn() {
  G.player = {
    // ...
    jumpsLeft: 1,        // ← 新增
  };
}
```

### 第三步：改跳跃条件

```js
if (G.buffer > 0 && (p.grounded || G.coyote > 0 || p.jumpsLeft > 0)) {
  p.vy = -JUMP_V;
  p.jumpsLeft -= 1;      // ← 消耗一次
  G.buffer = 0;
  G.coyote = 0;
  p.grounded = false;
  p.onMover = null;
  p.jumpCut = false;
  sfx(520, 0.06, 'square', 0.026);
}
```

### 第四步：落地时恢复

```js
if (p.grounded) {
  G.coyote = COYOTE;
  p.jumpsLeft = 1;       // ← 新增
}
```

### 第五步：处理边界情况

这几条不想清楚，会得到一堆「偶尔能用偶尔不能用」的 bug：

| 情况 | 应该怎样 |
|---|---|
| 土狼时间内起跳 | 消耗哪一次？—— 建议消耗"地面那次"，因为玩家认为自己还站在地上 |
| 掉落死亡后重生 | `jumpsLeft` 必须重置（在 `respawn()` 里） |
| 二段跳时松开按键 | 变高跳的截断还生效吗？—— 建议生效，保持一致 |
| 站在移动平台上 | 平台算不算"地面"？—— 算，落地时重置 |

### 第六步：加断言

改了机制就要加断言，否则下次改动会不知不觉破坏它：

```js
// 在 systems.test.mjs 里
settle(16);
G.requestJump(); g.env.step(20);       // 第一跳
const afterFirst = G.player().y;
G.requestJump(); g.env.step(20);       // 第二跳
r.ok(G.player().y < afterFirst, '空中可以再跳一次');
G.requestJump(); g.env.step(20);       // 第三跳
r.ok(/* 高度没有继续升高 */, '二段跳用完后不能再跳');
```

---

## 7. 改成一关更长 / 有记录点

关卡加长只需要在 `rows` 里多写几行 —— 但要注意**相机和关卡高度是写死的**。

平台跳跃的 `OFFSET_Y = 20` 和 `VIEW_ROWS = 20` 假设关卡正好 20 行高、纵向不滚动。想加长有两种做法：

**做法 A：只加宽（推荐）**

保持 20 行不变，把每行从 48 字符扩到 96 字符。相机横向跟随的逻辑不用改。

**做法 B：加高，改成双向滚动**

需要改三处：

```js
// 1. update() 里的相机：把 camY 也算出来
G.camY = clamp(playerY - H/2, 0, levelHeight - H);

// 2. render() 里的 camY
const camY = Math.round(G.camY) + OFFSET_Y;   // 不再用常量 OFFSET_Y

// 3. 瓦片绘制的行范围（现在只算列范围）
const r0 = Math.max(0, Math.floor((camY - OFFSET_Y) / TILE) - 1);
const r1 = Math.min(lv.rows - 1, r0 + Math.ceil(H / TILE) + 2);
```

**别只是加行数就不管了** —— 那样下面的关卡内容会跑到屏幕外，而且因为"下越界当作空"，玩家会从关卡底部掉出去。

**记录点**：在关卡数据里加一个字符 `C`，解析时收集成数组：

```js
else if (ch === 'C') checkpoints.push({ x: c * TILE + 2, y: r * TILE + 2 });
```

`killPlayer()` 里改成「回到最近一个已激活的记录点」：

```js
function respawn() {
  const cp = G.activeCheckpoint || G.level.spawn;
  // ... 用 cp 而不是 G.level.spawn
}
```

激活判断放在 `physics()` 里，和金币拾取同一个位置。

---

## 8. 加音效 / 换音效

音效是现场合成的，没有音频文件 —— 这是为了守住「单文件 + 离线」两个前提。

```js
function sfx(freq, dur, type, gain) {
  try {
    if (typeof AudioContext === 'undefined') return;   // ← 这行不能删
    // ...
  } catch (e) { /* 静默降级 */ }
}
```

调用形式：

```js
sfx(520, 0.06, 'square', 0.026);
//  频率  时长  波形      音量
```

| 波形 | 听感 | 适合 |
|---|---|---|
| `square` | 干、电子味 | 跳跃、射击、撞击 |
| `triangle` | 柔和一点 | 拾取、升级 |
| `sawtooth` | 粗糙、有攻击性 | 受伤、爆炸 |

**两条纪律**：

1. **`try/catch` 和 `typeof` 检查不能删**。没有音频设备的环境（比如自动化测试）里，`new AudioContext()` 会抛异常 —— 没删的话整个游戏在第一次发声时就崩了。
2. **同名音效在同帧内要收敛**。弹幕射击里一次爆炸可能同时触发十几个音效，直接相加会削顶，听起来是「突然变吵」。真要做复杂音效，至少加一个「同帧同名去重」和总音量上限。

---

## 9. 加个"最高分"存档

贪吃蛇已经做了，可以直接抄。

```js
const memStore = {};

function storageGet(key) {
  try {
    const v = window.localStorage.getItem(key);
    return v == null ? memStore[key] ?? null : v;
  } catch (e) { return memStore[key] ?? null; }
}

function storageSet(key, value) {
  memStore[key] = String(value);
  try { window.localStorage.setItem(key, String(value)); } catch (e) { /* 降级到内存 */ }
}
```

**为什么必须包 `try/catch`**：`localStorage` 在隐私模式、某些 `file://` 场景、以及企业策略下会直接抛异常。不包的话，游戏会在「存档」这一步整体崩掉 —— 而且是在玩家刚玩出好成绩、最想保存的那一刻。

内存降级意味着这一局的有效，重开就没了。比崩溃好得多。

**读路径也要测**。只断言「写进去了」是不够的 —— 新建一个实例、把同一份存储灌进去、重新加载，再断言状态被读回来。`tests/systems.test.mjs` 里的「最高分跨实例持久化」就是这么写的。

---

## 10. 适配手机触屏

目前只处理了键盘和鼠标。加触屏要动两处。

### 虚拟按键

最简单的做法：在 HTML 里加几个绝对定位的按钮，用 `pointerdown` / `pointerup` 驱动和键盘同一套输入状态。

```html
<div id="touch">
  <button class="pad" data-k="left">←</button>
  <button class="pad" data-k="right">→</button>
  <button class="pad" data-k="jump">跳</button>
</div>
```

```js
for (const btn of document.querySelectorAll('.pad')) {
  const key = btn.dataset.k;
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (key === 'left') Input.left = true;
    if (key === 'right') Input.right = true;
    if (key === 'jump') G.buffer = JUMP_BUFFER;
  });
  btn.addEventListener('pointerup', e => {
    if (key === 'left') Input.left = false;
    if (key === 'right') Input.right = false;
  });
}
```

用 `pointerdown/up` 而不是 `touchstart/end`：前者在鼠标和触摸上都能用，同一套代码覆盖两种设备。

### `pointer-events` 的坑

`#ui` 层现在是 `pointer-events: none`（为了不挡住 canvas 上的鼠标操作）。虚拟按键在那个层里的话会**完全收不到点击**。

必须给按钮单独打开：

```css
#touch { pointer-events: auto; }
```

同时那个「隐藏的覆盖层仍然会接住点击」的坑在这里也会出现 —— 覆盖层显示时要把 `#touch` 也一起禁用，否则玩家会透过开始面板点到跳跃键。

```css
#ov.on ~ #touch { pointer-events: none; }
```

### 布局

640×360 在竖屏手机上会被缩得很小。如果认真做移动端，考虑在竖屏时把 `#stage` 旋转 90°：

```js
if (window.innerHeight > window.innerWidth) {
  stage.style.transform = 'rotate(90deg)';
  // 位置和缩放都要按下旋转后的坐标系重算
}
```

这会让 `resize()` 复杂不少。**如果只是想「能玩」，加虚拟按键就够了；横屏提示比旋转变换省事得多。**

---

## 改完之后

```bash
npm test
```

四套测试会依次跑。如果改的是关卡数据或手感参数，特别留意：

- `core.test.mjs` —— 关卡能不能解析、能不能解
- `smoke.test.mjs` —— 自动驾驶能不能通关
- `systems.test.mjs` —— 手感数字还在不在设计范围内
- `dom-check.mjs` —— 界面元素有没有对不上的

**四套全绿再提交。** 这些断言存在的唯一意义就是在你改坏东西的时候拦住你 —— 全部跳过它们，等于把项目退回到「看起来能跑」的水平。
