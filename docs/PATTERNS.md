# 可复用的模式

这些是所有小游戏共用的东西，也是做这类项目时真正会卡住的地方。
每条都带「症状 → 原因 → 做法」，因为在踩坑之前你搜不到它们。

---


## 目录

- [一、时间](#一时间)
- [二、渲染](#二渲染)
- [三、输入](#三输入)
- [四、碰撞](#四碰撞)
- [五、状态](#五状态)
- [六、关卡与内容](#六关卡与内容)
- [七、工程](#七工程)
- [八、本地化](#八本地化)
- [九、测试](#九测试)
- [十、一条元规律](#十一条元规律)

---

## 一、时间

### 固定步长 + 累加器

**症状**：在自己电脑上跳得刚好，交给用 144Hz 屏幕的朋友就跳不过同样的坑。

**原因**：物理更新直接用 `requestAnimationFrame` 给的 `dt`。帧率不同，每次积分的步长就不同，位置误差累积成可见的差异。

**做法**：

```js
const STEP = 1 / 120;
let acc = 0, last = 0;

function frame(now) {
  if (!last) last = now;
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 16) { update(STEP); acc -= STEP; steps++; }
  if (steps === 16) acc = 0;
  render();
  requestAnimationFrame(frame);
}
```

**两个上限都不能省**：

- `dt > 0.25` 截断：切到别的标签页再切回来，`dt` 可能是几十秒
- `steps < 16`：防止一帧内补几百步（后果是角色瞬移穿墙）
- `steps === 16` 时清空 `acc`：追不上就放弃这一帧，不要让欠账越滚越多

**步长怎么选**：1/120 对像素游戏够用。最小瓦片 16px、最大下落速度 520px/s 时，单个子步走 4.3px —— 安全。速度再快就得在碰撞函数里自己细分。

### 与帧率无关的平滑

**症状**：换了刷新率，镜头跟随的快慢变了。

**做法**：用指数平滑，不要线性逼近。

```js
// 错：与 dt 线性相关，帧率一变感觉就变
x += (target - x) * 0.2;

// 对：指数衰减，与帧率无关
x += (target - x) * (1 - Math.exp(-k * dt));
```

`k` 越大跟得越紧。镜头跟随一般用 6~8，挡板跟随用 20 左右。

---

## 二、渲染

### 双缓冲式的分层缩放

**症状**：像素图很锐利，但 HUD 上的中文小字糊成一团。

**原因**：所有东西都画在低分辨率 canvas 上，然后整体放大。12px 的中文在 640×360 上位图里只有几个像素宽，放大后笔画糊在一起。

**做法**：canvas 走位图放大，UI 走矢量缩放。

```html
<div id="stage">
  <canvas id="world" width="640" height="360"></canvas>
  <div id="ui"></div>
</div>
```

```css
#stage { position: absolute; transform-origin: 0 0; }
#world { display: block; image-rendering: pixelated; }
#ui    { position: absolute; width: 640px; height: 360px;
         transform-origin: 0 0; pointer-events: none; }
```

```js
cvs.style.width = (640 * s) + 'px';     // 位图：整数倍 CSS 尺寸
ui.style.transform = 'scale(' + s + ')'; // DOM：矢量缩放
```

**三个必须注意的点**：

1. `s` 要取整。非整数倍会让像素落在半像素边界上，出现模糊。
2. `transform-origin: 0 0` 不能省。默认原点在中心，和手动 `left/top` 居中是两套坐标系，会打架。
3. **`image-rendering: pixelated` 在 CSS transform 缩放下的行为跨浏览器不一致**，所以 canvas 用直接设置 CSS 尺寸，不要用 transform。只有纯矢量的 DOM 层才用 transform。

### 预计算，不要在渲染循环里分配

**症状**：粒子一多就掉帧。

**原因**：每帧都在做对象/字符串分配。

**做法**：

```js
// 光照分级用查表，不要每帧拼字符串
const LIGHT_LEVELS = [];
for (let i = 0; i < 16; i++) {
  LIGHT_LEVELS.push('rgba(255,240,200,' + (i / 15 * 0.8).toFixed(3) + ')');
}
```

自检方法：跑一段正式游戏，断言 `ctxCalls.createRadialGradient === 0`。运行期创建渐变几乎总是可以预渲染掉的。

### 原地压缩代替 filter

**症状**：每帧都在产生垃圾，GC 抖动。

**做法**：

```js
function prune(arr, isDead) {
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (!isDead(arr[i])) arr[n++] = arr[i];
  arr.length = n;
}
```

比 `arr = arr.filter(...)` 少一次数组分配。在每帧都要跑的地方值得这么写。

注意：**命中停顿（hitstop）期间要跳过压缩**。世界暂停了但实体还在数组里，靠 `enemies.length === 0` 判断"清场"会延迟。

---

## 三、输入

### 两个游戏输入事件的目标不一样

**症状**：测试里玩家的鼠标状态永远卡在按下，后续所有断言都在污染状态下跑。

**原因**：`keydown` 监听在 `window` 上，而 `mousedown` 监听在 canvas 上。测试的 mock 必须派发到正确的目标。

**做法**：写测试替身前，先把源码里所有 `addEventListener` 的目标列一遍。

```js
const fireWin = (t, e) => (winListeners[t] || []).forEach(f => f(e));
const fireCanvas = (t, e) => (canvasEl.listeners[t] || []).forEach(f => f(e));
```

### 意图缓冲：不要只做电平采样

**症状**：玩家说"有时候点了没反应"。你测不出来，因为你自己按键够久。

**原因**：攻击判定读的是"按键当前是否按下"。触控板轻拍或高刷屏上的极短按压可能短于一帧，整段落在两次采样之间被丢掉。

**做法**：按下瞬间记一个时间戳，让"想攻击"这件事存活一小段时间。

```js
const ATTACK_BUFFER = 0.15;
let buffer = 0;
onKeyDown(() => { buffer = ATTACK_BUFFER; });

function update(dt) {
  if (buffer > 0) buffer -= dt;
  if (buffer > 0 && cooldown <= 0) { attack(); buffer = 0; }
}
```

**缓冲必须短**（0.15~0.2 秒），否则会攒出"迟到的一刀"。而且**离开战斗态时要立即清空**（打开菜单、暂停），不然回来会莫名其妙打一下。

### 跳跃类机制的两个宽限

这两个是平台游戏手感的分水岭：

| 机制 | 解决什么 | 建议值 |
|---|---|---|
| 土狼时间 | "刚从平台边缘走出去，按跳没反应" | 0.10s |
| 跳跃缓冲 | "落地前提前按了跳，落地却不跳" | 0.12s |

```js
if (G.buffer > 0) G.buffer -= dt;
if (G.coyote > 0) G.coyote -= dt;

if (G.buffer > 0 && (p.grounded || G.coyote > 0)) {
  p.vy = -JUMP_V;
  G.buffer = 0;
  G.coyote = 0;
}
if (p.grounded) G.coyote = COYOTE;      // 落地时刷新
```

**不要超过 0.2 秒**。太长的宽限会让玩家觉得"明明没按却跳了"，反而更难控制。

### 变高跳的截断只能施加一次

**症状**：轻轻一点跳跃几乎跳不起来。

**原因**：截断写成了每帧判定。

```js
// 错：松手之后上升的每一帧都乘一次 0.42
if (!jumpHeld && vy < 0) vy *= 0.42;
```

松手后上升有十几帧，0.42 连乘十几次，速度直接被砍到接近零。

**做法**：加一个标志位，只截断一次。

```js
if (!jumpHeld && p.vy < 0 && !p.jumpCut) {
  p.vy = cutJump(p.vy, JUMP_CUT);
  p.jumpCut = true;
}
// 在起跳时重置：p.jumpCut = false
```

这个 bug 数值上完全合理（一次乘 0.42 没问题），只有真去量跳跃高度才会暴露。所以测试里要量。

---

## 四、碰撞

### 轴分离求解

**症状**：角色贴着墙角走会卡住或者抖动。

**原因**：一步同时解 x 和 y。斜向的一步同时撞到侧面和地面时，求解器分不清该往哪个方向推。

**做法**：先只解 x，再只解 y。

```js
moveX(box, level, vx * sdt);       // 只处理水平
moveY(box, level, vy * sdt, prevBottom);  // 只处理垂直
```

每个方向只有一种推法，天然不会冲突。

**前提**：单步位移要小于一个瓦片，否则会穿过薄墙。做不到就细分：

```js
const steps = Math.max(1, Math.ceil(Math.max(Math.abs(vx), Math.abs(vy)) * dt / 4));
```

### 圆与矩形：找最近点

比"逐边判定"少一半分支，而且天然处理了"圆心在矩形内部"这个退化情况。

```js
function circleRect(cx, cy, r, rx, ry, rw, rh) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));   // 矩形上离圆心最近的点
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx, dy = cy - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 > r * r) return null;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, ny: dy / d, depth: r - d };
  }
  // 圆心落在内部：沿最小穿透方向推出
  const left = cx - rx, right = rx + rw - cx;
  const top = cy - ry, bottom = ry + rh - cy;
  const m = Math.min(left, right, top, bottom);
  if (m === left)  return { nx: -1, ny: 0, depth: left + r };
  if (m === right) return { nx: 1, ny: 0, depth: right + r };
  if (m === top)   return { nx: 0, ny: -1, depth: top + r };
  return { nx: 0, ny: 1, depth: bottom + r };
}
```

拿到法线之后，先沿法线把球推出（`depth + 0.01`），再反射速度。**推出这一步不能省** —— 不然下一子步会重复命中同一个物体。

### 单向平台：靠"上一帧的脚底位置"

**症状**：从下方跳上去被挡住（变成"天花板"），或者站在上面会漏下去。

**做法**：碰撞条件里带上移动前的脚底位置。

```js
if (dy > 0) {
  const r = Math.floor((box.y + box.h - 0.001) / TILE);
  for (let c = c0; c <= c1; c++) {
    const t = tileAt(level, c, r);
    if (t === SOLID || (t === ONEWAY && prevBottom <= r * TILE + 0.6)) {
      box.y = r * TILE - box.h;
      return 'floor';
    }
  }
}
```

`prevBottom <= 平台顶面` 这一条就是"是不是从上方落下来的"。

### 越界规则要想清楚，尤其是下方

**症状**：玩家掉进坑里，不会死，而是卡在坑底动不了。

**原因**：`tileAt` 对"下方越界"返回了实心，理由通常是"防止掉出世界"。实际效果是在整个关卡下面铺了一层**隐形地板**。

**做法**：

```js
function tileAt(level, c, r) {
  if (r < 0) return EMPTY;              // 上方：允许跳出屏幕顶
  if (r >= level.rows) return EMPTY;    // 下方：空的，让玩家掉出去
  if (c < 0 || c >= level.cols) return SOLID;  // 左右：关卡外墙
  return level.grid[r][c];
}
```

然后由游戏层判定"y 超过关卡底部 = 死亡"。

**这个 bug 最阴的地方是它会被测试背书** —— 如果测试里写着「下越界当作实心」，那它就变成"规格"了。**规格写错时，测试不但不帮忙，还帮着掩盖。**

---

## 五、状态

### 移动写成不可变操作

**收益**：撤销、求解器、回放三件事一次到手。

```js
// 返回新状态；走不通返回 null。不修改传入的 state。
function tryMove(state, dx, dy) {
  const nx = state.px + dx, ny = state.py + dy;
  if (isWall(state, nx, ny)) return null;

  const nk = key(nx, ny);
  if (state.boxes.has(nk)) {
    const bx = nx + dx, by = ny + dy;
    if (isWall(state, bx, by) || state.boxes.has(key(bx, by))) return null;
    const boxes = new Set(state.boxes);     // ← 复制，不改原件
    boxes.delete(nk);
    boxes.add(key(bx, by));
    return { ...state, boxes, px: nx, py: ny, moves: state.moves + 1 };
  }
  return { ...state, px: nx, py: ny, moves: state.moves + 1 };
}
```

于是：

- **撤销** = 把旧 state 压栈，不需要写"反向操作"
- **求解器** = BFS 直接跑在这个函数上，同一份规则不会有两处实现
- **回放** = 状态序列就是录像

反例是 `G.player.x += dx` 这种就地修改：上面三样都得各写一遍，而且三份实现迟早会跟规则不一致。

### 状态推进要排在决策之前

**症状**：固定炮台永远卡在蓄力，一炮不发。

**原因**：把"触发判断"写在"前摇推进"之前，于是每帧都把前摇计时重置为满值。

**做法**：`updateEnemy` 里的顺序应该是：

```
冷却衰减 → 特殊循环 → 状态推进（windup / strike / recover）→ 各兵种的决策
```

### 状态绑动作，不要绑计时器

**症状**：冲刺结束后的 0.15 秒里玩家"没在冲刺却打不动"。

**原因**：无敌写成独立的 0.30s 计时器，而冲刺位移只有 0.155s。

**做法**：受击时直接问"你正在冲刺吗"。

```js
// 好：判据是状态本身
if (p.dashTime > 0) return;   // 冲刺期间免疫

// 差：两个长度相近的计时器，迟早漂移
if (p.invuln > 0) return;
```

让"动作时长"和"无敌时长"共用同一个常量，从结构上杜绝漂移。

### 阈值判定不要寄生在重绘缓存里

**症状**：血量从 30.1% 掉到 29.9%（整数显示都是 30）时，预警**不亮**，要再挨一下才亮。

**原因**：为了省下每帧写样式的开销，UI 拿四舍五入后的值当重绘签名。条件判定写在了这个 `if` 块里，于是恰好跨过阈值的那一次扣血被跳过了。

**做法**：条件触发型表现（预警、闪烁、状态切换）的判定独立出来，每帧比较一个布尔值。成本可以忽略。

### 加新机制后要追问"核心机制真的生效了吗"

视觉表现（粒子、光环、预警圈）很容易做对，而伤害结算、状态流转可能完全没跑。

```
看起来在动 ≠ 真的在生效
```

本项目踩过的具体形态：

- 道具加了图标，但忘了在 `G.effects` 里初始化 → 计时遍历漏掉它，永远不生效
- 技能从"实体上读召唤池"读的是**永远不存在**的字段 → 所有 Boss 都走了兜底分支、召唤同一种小兵。它不报错、行为也说得过去 —— **因为兜底值恰好就是"看起来正常"的那一个**

防范：把"实际用了哪条分支"暴露到调试接口里，并给"配置真的生效了"单独写断言，而不是只看最终效果像不像。

---

## 六、关卡与内容

### 关卡写成数据，不要写成代码

```js
const LEVELS = [
  ['111111111111',
   '111111111111'],
];
```

"加一关"变成"多打几行字"，不碰任何逻辑。

**代价是要防手滑**：行宽不一致、非法字符、忘了放出生点。这些都要有断言兜着（本项目里 `parseLevel` 会对缺失的出生点/终点直接抛错）。

### 缺口宽度要和跳跃距离对上

```
水平跳跃距离 ≈ 最大跑速 × (2 × 起跳速度 / 重力)
             = 168 × (2 × 428 / 1500) = 96px = 6 格
```

关卡里的坑最宽 5 格（80px），留了 16px 余量。

**这个数字必须能被机器验证**。本项目用两个方式：

1. `systems.test.mjs` 断言"最宽的坑 ≤ 跳跃距离"
2. `smoke.test.mjs` 用一个自动驾驶把每一关真的跑一遍

第二条尤其有用，因为它同时验证了地形可通行、物理参数够用、终点确实能触发。

### 让关卡能被机器验证

**这一条改变的是关卡设计的自由度，不只是测试覆盖率。**

本项目最初的「渡河」关用 7~8 格的缺口，逼玩家必须等移动平台。玩法上说得通，但带来一个实际代价：**自动驾驶没法"等平台飘过来"，于是"这关能不能通"就只能靠人肉试**。

缺口收窄到 5 格（可跳越）、移动平台改成"更省事的路线"之后，自动驾驶能一次跑完四关，关卡设计从此有了机器保障。

**在"必须这样才能过"和"能被自动化验证"之间，小项目应该优先后者。**

### 移动平台的位置要能被算出来

平台位置用**时间函数**而不是累积位移：

```js
function moverPos(m, t) {
  const off = Math.sin(t * m.speed + m.phase) * m.range;
  return m.axis === 'y' ? { x: m.x, y: m.y + off } : { x: m.x + off, y: m.y };
}
```

好处：位置可以随时重算，不会因为丢帧而漂移；同一个 `t` 必然得到同一个位置（可测试）。

**站在平台上的玩家要跟着一起动**：

```js
// 1) 平台先走，并记下本帧位移
for (const m of G.movers) { const prev = m.px; m.px = moverPos(m, time).x; m.dx = m.px - prev; }

// 2) 玩家如果站在平台上，跟着走同样的位移
if (p.onMover) { p.x += p.onMover.dx; p.y += p.onMover.dy; }

// 3) 再做玩家的输入和碰撞
```

### 难度曲线的问题往往在"分布"不在"数值"

引入新敌人时若让它和其他种类同权出场，某一波的平均强度会直接跳崖（实测过单波 +95%）。

**做法是渐进登场**：

```js
let spinnerWeight = 0;
if (wave >= 6) spinnerWeight = 0.34;      // 满权重
else if (wave >= 4) spinnerWeight = 0.18; // 首次出现，只占一小部分
```

同类问题还有 Boss 阶段阈值、掉落权重、技能解锁节奏 —— **调整分布比调整数值更有效**。

---

## 七、工程

### 单文件的三条硬约束

1. **不能用 `<script type="module">`** —— `file://` 下会被 CORS 拦住，双击打不开
2. **不能引用任何外部资源** —— CDN、字体、图片、`fetch` 全部禁止，否则谈不上离线
3. **不能用构建步骤** —— 源码就是产物

静态检查里有一条专门扫这些（`externalRefs()`），所以不会写着写着破坏掉。

### `innerWidth` 要写 `window.` 前缀

值型全局不能在测试环境里靠参数注入 —— 注入的是一个被定格在启动瞬间的旧值，`resize` 之后取不到新的。

函数型全局（`addEventListener`、`requestAnimationFrame`）可以注入，因为它们的值不会变。

### `localStorage` 必须能降级

隐私模式、某些 `file://` 场景、企业策略下都会抛异常。不包 `try/catch` 的话，游戏会在"存档"这一步整体崩掉 —— 而且是在玩家刚玩出好成绩、最想保存的那一刻。

```js
function storageSet(key, value) {
  memStore[key] = String(value);                       // 先写内存
  try { window.localStorage.setItem(key, String(value)); } catch (e) { /* 降级 */ }
}
```

### 种子随机

**所有游戏逻辑走种子 RNG，只有表现层用真随机。**

```js
// 逻辑：可复现
const rng = makeRNG(seed);

// 表现：屏幕震动、音效噪声、开局种子本身 → Math.random 无所谓
ctx.translate((Math.random() - 0.5) * shake, ...);
```

好处有两个：测试稳定（不会因为一次运气好坏就变红），以及"同种子完全复现整局"这个可以给玩家的特性。

**验证方式**：同种子 + 同操作 → 球的轨迹逐帧一致。不同种子 → 不同。

### 事件驱动的逻辑要写在事件里

**症状**：击杀 Boss 应该开门，但"击杀同时弹出升级面板"时门不开。

**原因**：开门逻辑写在主循环的某个阶段，而面板让 `update` 提前 `return` 了，调度器根本没机会跑到。

**做法**：凡是"某件事发生后就该立刻生效"的逻辑，都在事件处理函数里直接调用。每帧调度只作为兜底。

### 隐藏的覆盖层仍然会接住点击

**症状**：战斗中点击屏幕中央，结果重开了一局。

**原因**：父层写了 `pointer-events: none`，但**这挡不住子元素**。隐藏面板里的按钮写着 `pointer-events: auto`，仍然在命中测试里。

**做法**：双重防范。

```css
/* 1) 整棵子树一起失活 */
.overlay:not(.on) * { pointer-events: none; }
```

```js
// 2) 每个按钮再套一层状态守卫
btn.onclick = () => {
  if (G.state !== 'menu') return;   // 面板不在就直接返回
  startRun();
};
```

即使样式被改坏也不会误触。这类 bug 只在实机可见，测试完全测不到。

### 兜底逻辑不该覆盖"明确表达的零"

伤害下限 `Math.max(1, ...)` 的本意是"任何命中都不该完全无效"，但它让调试用的倍率 ×0 仍然打出 1 点伤害。

判据要写成"原始值 > 0 时才套用下限"，而不是把下限写死。同理适用于"最小移动速度""最小攻击间隔"—— **凡是兜底，都要问一句：上层如果把值设成 0，是想表达什么**。

### 兜底值恰好合理时，缺陷会隐形

一个"读不到就用默认值"的分支，如果默认值恰好是"看起来正常"的那一个，缺陷就永远暴露不出来。

防范：**把"实际用了哪条分支"暴露到调试接口**，并给"配置真的生效了"单独写断言，而不是只看最终效果像不像。

---

## 八、本地化

### 两种语言装在同一个文件里

**诱人的替代方案**：再做一个 `game.en.html`。

**为什么不做**：两份文件手工维护，就意味着"改了一个 bug 忘了另一个"，而且没有任何机制能发现这种分叉。装在同一文件里，双语共用一套逻辑、只把文本抽出来 —— 顺带让测试能断言两个键集完全对齐。

```js
const TEXTS = {
  zh: { 'start.title': '打砖块', 'over.body': '得分 {score}…' },
  en: { 'start.title': 'Breakout', 'over.body': 'Score {score}…' },
};

function T(key, params) {
  const table = TEXTS[LANG] || TEXTS.zh;
  let s = Object.prototype.hasOwnProperty.call(table, key)
    ? table[key]
    : (TEXTS.zh[key] != null ? TEXTS.zh[key] : key);
  if (params) {
    s = s.replace(/\{(\w+)\}/g, (whole, name) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole);
  }
  return s;
}
```

**取不到键时返回键名本身**，这是刻意的：打错一个字母会在界面上直接显示成 `over.titel`，而不是悄悄渲染出 `undefined`。

### 检测顺序：URL → 上次选择 → 浏览器语言

```js
function detectLang() {
  // 1) URL 参数 —— 最高优先级，方便分享指定语言的链接
  const m = (window.location && window.location.search || '').match(/[?&]lang=(zh|en)\b/);
  if (m) return m[1];

  // 2) 上次的选择 —— 也要能读得到，否则刷新就跳回浏览器语言
  const saved = window.localStorage.getItem('sfpg.lang');
  if (saved === 'zh' || saved === 'en') return saved;

  // 3) 浏览器语言
  const tag = (window.navigator || {}).language || '';
  return /^zh\b/i.test(tag) ? 'zh' : 'en';
}
```

每一步都要包在 `try/catch` 里。`location` 在 `file://` 下可能受限，`localStorage` 在隐私模式下必抛 —— **语言检测绝不能成为游戏启动不了的原因。**

### 记住"该显示哪条文案"，而不是记住渲染好的字符串

**症状**：开局画面上按 L，开始界面纹丝不动；结算画面上按 L 却正常。**只有一屏失效。**

**原因**：覆盖层的辅助函数存的是**渲染好的文本**，而开始界面那一屏的 `overlayKeys` 初始化成了 `null` —— 重绘逻辑拿不到东西，直接返回了。

**做法**：存键和参数，重绘时现算。

```js
let overlayKeys = { titleKey: 'start.title', bodyKey: 'start.body', hintKey: 'start.hint', params: null };

function showOverlay(titleKey, bodyKey, hintKey, params) {
  overlayKeys = { titleKey, bodyKey, hintKey, params: params || null };
  paintOverlay();
  $ov.classList.add('on');
}

function paintOverlay() {
  if (!overlayKeys) return;
  const { titleKey, bodyKey, hintKey, params } = overlayKeys;
  $ovTitle.textContent = T(titleKey, params);
  if (bodyKey) $ovBody.innerHTML = T(bodyKey, params);
  $ovHint.textContent = T(hintKey, params);
}
```

这样切换语言只是一个调用，任何调用点都不需要写自己的刷新逻辑。**这个 bug 只影响一屏**，所以随手玩几下是发现不了的。

### 断言两个键集完全一致

漏一条翻译是**静默失败**：界面上只是某一处还显示着另一种语言，或者干脆显示出键名。

```js
const missingInEn = zhKeys.filter(k => !(k in enPairs));
ok(missingInEn.length === 0, '英文表没有漏掉任何键', missingInEn.join(', '));
```

占位符同理。少一个 `{score}`，那一句就成了带洞的句子：

```js
const ph = s => (s.match(/\{(\w+)\}/g) || []).sort().join(',');
if (ph(zhPairs[k]) !== ph(enPairs[k])) mismatch.push(k);
```

### mock 的 `documentElement` 必须是同一个节点

**症状**：游戏设置了 `<html lang>`，测试读回来是 `null`。

**原因**：mock 把 `document.documentElement` 造成了一个**独立对象**，和 `getElementById('html')` 背后的那个不是一回事。真实浏览器里它们是同一个节点。

**做法**：

```js
const documentMock = {
  getElementById: id => getEl(id),
  get documentElement() { return getEl('html'); },
  get body() { return getEl('body'); },
};
```

这条值得推广成通则：**凡是 mock 里有两条路能拿到同一个东西，它们就必须返回同一个对象。** 否则测试测的是 mock，不是代码。

### 切换语言不能动到游戏状态

换文本是表现层的事。要断言它确实只是表现层：

```js
const before = { state, score, dir, head: JSON.stringify(body[0]) };
env.key('L');
const after  = { state, score, dir, head: JSON.stringify(body[0]) };
ok(JSON.stringify(before) === JSON.stringify(after), '切换语言不影响任何游戏状态');
```

这能拦住"顺手把别的东西也重置了"这一类错误，而手动测试基本发现不了它们。

---

## 九、测试

### mock DOM 必须配静态检查

mock 通常会在 `getElementById` 时**自动创建任何 id**。好处是测试好写，坏处是「引用了不存在的元素」这类错误永远暴露不出来 —— 直到你在真实浏览器里打开。

```js
// 静态检查：JS 引用的每个 id 都必须在 HTML 里声明
const declared = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const referenced = new Set([...script.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)].map(m => m[1]));
const missing = [...referenced].filter(id => !declared.has(id));
```

### 拼接出来的界面也要静态检查

mock 不解析 `innerHTML`，所以标签漏闭合、类名拼错都测不出来。

**注意不能逐个字符串字面量检查** —— 界面字符串几乎总是拼接出来的：

```js
'得分 <span class="keys">' + n + '</span>　剩余'
```

`<span>` 和 `</span>` 分处两个字面量，逐字面量比必然误报。要先按括号配平切出整个调用范围，把其中所有字面量接起来再比。

### 对象快照要深拷贝

```js
// 错：拿到的是引用，后续比较永远相等
const before = GAME.upgradeLevels();

// 对
const before = JSON.parse(JSON.stringify(GAME.upgradeLevels()));
// 或者对简单的对象
const before = { ...GAME.player() };
```

**这个断言永远通过、等于没写。** 本项目里 `p0.x > p1.x` 就栽在这上面。

### 测试之间要清理输入状态

压力测试常常在结束前按下方向键就不管了；下一个测试的玩家会持续朝那个方向移动，症状是「靶子根本不在预期位置」这类**看起来像功能坏了的假失败**。

把"释放所有按键 + 鼠标抬起"放进每次测试的隔离函数里，成本几乎为零。

### 断言不要抄第二份真值

把游戏里的数值曲线在测试里重写一遍（`1 + (f-1)*0.20`）看着"独立可靠"，实际结果是"改了游戏数值而断言还在测旧曲线"——**测试全绿反而是假象**。

断言的输入要直接向游戏查询：

```js
// 好：问游戏要
const mul = f => E.enemyHpAt(f, 'crawler') / E.enemyHpAt(1, 'crawler');

// 差：抄一份
const mul = f => 1 + (f - 1) * 0.20;
```

### 取值要避开饱和区

```js
// 错：cap=2 时 1 + hits*0.012 在 hits≈84 就饱和了
ok(speedMultiplier(100, 2) < speedMultiplier(200, 2));   // 两个都是 2

// 对：取饱和点两侧
ok(speedMultiplier(10, 2) < speedMultiplier(30, 2));
ok(speedMultiplier(200, 2) === speedMultiplier(400, 2));
```

**测试取值本身也要考虑实现曲线**，否则很容易测错东西 —— 上面那个断言实际在测"夹取"而不是"递增"。

### 自检：静态检查本身有效吗

一个永远通过的检查等于没写。给检查器配合成样本：

```js
const fakeHtml = '<div id="a"></div>';
const fakeScript = "document.getElementById('c');";
const missing = [...referencedIds(fakeScript)].filter(id => !declaredIds(fakeHtml).has(id));
ok(missing.length === 1, '合成样本：引用未声明的 id 能被抓出来');
```

同样重要的是**验证守卫真的会拦**：植入一个违规，确认它报错，再移除。本项目验证隐私守卫时就是这么做的。

### 测试环境的探针不要走 shell

Git Bash 的 `printf` / heredoc 会吃掉反斜杠（`C:\Users` → `C://Users`）。曾因此误判「守卫漏报」—— 实际是探针文件被 shell 破坏了。

**写含反斜杠的探针用脚本语言写，不要用 shell 重定向。**

### `cmd | tail -N && echo OK` 会吞掉退出码

管道后面跟 `&&`，判断的是 `tail` 的退出码，不是 `cmd` 的。曾因此把一个构建失败误报成成功。

要么别接管道，要么显式取 `"${PIPESTATUS[0]}"`。

### 计数要在状态跃迁时加一

```js
// 错：状态持续期间每帧都会数一次
if (state === 'dead') deaths++;

// 对：只在进入的那一刻数
if (state === 'dead' && prevState !== 'dead') deaths++;
prevState = state;
```

否则「1500 帧里死了 320 次」这种明显不可能的数字会出现在报告里，而你还得花时间想为什么。

---

## 十、一条元规律

上面这些坑有一个共同点：**它们全都"看起来没问题"**。

- 跳跃截断每帧施加 —— 乘一次 0.42 完全合理
- 关卡底部隐形地板 —— "防止掉出世界"是个正当理由
- 只做电平采样的输入 —— 自己按键够久，测不出来
- 兜底值恰好合理 —— 缺陷藏在一个看起来正常的分支里

**所以"看起来能跑"不是验收标准。** 能被机器验证的东西才写下来当规格；验证不了的东西，至少要在文档里标明"未经实测"。
