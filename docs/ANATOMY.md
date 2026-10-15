# 拆解一个游戏

五个游戏的文件结构完全一致。看懂了一个，其余四个是同一套东西换内容。

---

## 一、三层分离

```
game.html
├── <style>                  UI 层：HUD、覆盖层，纯 CSS 矢量
├── <canvas id="world">      世界层：640×360 位图，pixelated 放大
└── <script>
    ├── /* #region CORE */   算法层：零 DOM、零副作用
    ├── /* #endregion */     游戏层：实体、状态机、渲染、主循环
    └── window.__GAME__      调试接口
```

### 为什么 UI 层和世界层要分开

直觉做法是把分数也画进 canvas。但低分辨率位图上的 12px 中文会糊成一团 —— 640×360 的画布被整数倍放大到 1280×720 时，位图上的字和像素一起被拉大，笔画糊掉。

所以：

| 层 | 缩放方式 | 结果 |
|---|---|---|
| `<canvas>` | 设置 CSS 尺寸（整数倍）+ `image-rendering: pixelated` | 像素保持锐利 |
| `<div id="ui">` | `transform: scale(n)`（矢量缩放） | 文字保持清晰 |

```js
function resize() {
  const vw = window.innerWidth, vh = window.innerHeight;
  // 取整除：非整数倍会让像素出现半像素模糊
  const s = Math.max(1, Math.floor(Math.min(vw / W, vh / H)));
  cvs.style.width  = (W * s) + 'px';
  cvs.style.height = (H * s) + 'px';
  ui.style.transform = 'scale(' + s + ')';
  stage.style.left = Math.round((vw - W * s) / 2) + 'px';
  stage.style.top  = Math.round((vh - H * s) / 2) + 'px';
}
```

两个细节不能省：

- **`transform-origin: 0 0`**。默认原点是元素中心，配合 `left/top` 手动居中会算错，位置随缩放漂移。
- **`innerWidth` 要写成 `window.innerWidth`**。值型全局不能靠参数注入 —— 测试环境里会拿到一个被定格在启动瞬间的旧值。

---

## 二、算法区（`#region CORE`）

这一段是整个结构里最值得学的东西。

### 规则只有一条：不碰 DOM

算法区里不允许出现 `document`、`canvas`、`ctx`、游戏的状态对象。它只是「进去一些值，出来一些值」。

代价是写的时候要绕一下：不能直接改 `G.player.x`，得返回新值让游戏层去应用。

收益是：

```js
// tests/load.mjs —— 把这一段从 HTML 里抠出来，在 Node 里直接求值
const core = html.match(/\/\* #region CORE[\s\S]*?\/\* #endregion CORE \*\//)[0];
const CORE = new Function(core + '\nreturn CORE;')();
```

**没有浏览器、没有 mock、没有渲染**，直接跑性质断言。

### 具体能测出什么

以推箱子为例，它的算法区只有四个函数：

```js
function tryMove(state, dx, dy) {   // 返回新状态；走不通返回 null
function isSolved(state) { ... }
function isDeadlocked(state) { ... }
function fingerprint(state) { ... }  // 求解器去重用
```

因为 `tryMove` 是纯函数，测试里可以这样写：

```js
// 广度优先搜索 —— 不需要写任何"反向操作"
const seen = new Set([C.fingerprint(start)]);
let frontier = [{ s: start, path: '' }];
while (frontier.length) {
  for (const node of frontier) {
    for (const [ch, dx, dy] of dirs) {
      const next = C.tryMove(node.s, dx, dy);
      if (!next) continue;
      if (C.isSolved(next)) return node.path + ch;   // 找到解法
      ...
    }
  }
}
```

十行代码，就证明了「六个关卡全部可解」。

这不是锦上添花的功能。**手写的关卡最常见的毛病就是根本无解**，而人眼完全看不出来：画面正常、走位自然、就是过不去。本项目的第 4 关第一版就是这样 —— 下面的箱子要往上推，但玩家必须站在箱子下方，而那里是墙。求解器一次就抓了出来。

### 反例：就地修改

如果写成 `G.snake.push(...)` 这种就地修改，上面所有好处同时消失：

- 撤销栈要另写一套「反向操作」，而且两套逻辑迟早不一致
- 求解器没法用 —— 搜索需要能自由地分叉出多个未来
- 回放没法做 —— 状态被改没了，只能记录操作序列再重放

**移动写成不可变操作，撤销、求解、回放三件事一次到手。**

---

## 三、游戏层

### 状态机

五个游戏的状态命名基本一致：

```
start → ready/play → clear → play → ... → win
                  ↘ dead → play
                  ↘ over → start
```

刻意统一，是为了让「按空格做什么」这件事在每个游戏里都一样。判断集中在 `keydown` 里一处：

```js
if (k === ' ' || k === 'Enter') {
  e.preventDefault();
  if (G.state === 'start') startRun();
  else if (G.state === 'ready') launch();
  else if (G.state === 'clear') loadLevel(...);
  else if (G.state === 'over' || G.state === 'win') startRun();
}
```

### 调参区

每个游戏的 `G` 对象上方都有一段集中的常量：

```js
/* ---- 调参区：手感相关的数字都集中在这里，改这里就够了 ---- */
const MAX_RUN      = 168;
const ACCEL_GROUND = 980;
const JUMP_V       = 428;
const COYOTE       = 0.10;
const JUMP_BUFFER  = 0.12;
```

把这些数字散落在各处是新手最常见的写法。集中之后有两个好处：改手感只要动一个地方；以及**能一眼看出这些数字之间的关系**（比如 `JUMP_V² / (2 × GRAVITY)` 就是跳跃高度）。

### 主循环

```js
const STEP = 1 / 120;
let acc = 0, last = 0;

function frame(now) {
  if (!last) last = now;
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;                // 切回标签页时不要一次补太多
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 16) {      // 上限防止连续狂奔
    update(STEP);
    acc -= STEP;
    steps++;
  }
  if (steps === 16) acc = 0;               // 追不上就放弃这一帧
  render();
  requestAnimationFrame(frame);
}
```

固定步长的意义：物理表现和帧率无关。60Hz 和 144Hz 屏幕上，跳跃高度必须一样。

累加器上限的意义：从后台切回来时 `dt` 可能是好几秒，不设上限的话一帧内会推几百步，角色直接穿墙。

### 调试接口

```js
window.__GAME__ = {
  state: () => G.state,
  player: () => G.player,        // 返回引用，测试可以改
  setSeed: n => { ... },
  teleport: (col, row) => { ... },
  // ...
};
```

三种用途：

1. **自动化测试的确定性驱动入口** —— 没有它就只能靠模拟键鼠，既慢又不准
2. **控制台里手动调参** —— 打开 devtools 就能试
3. **排查问题时省事** —— 不用每次都从头玩到出问题的地方

一条纪律：**调试接口调用的必须是正式逻辑，不能复制一份**。比如「给经验」应该是

```js
function checkLevelUp() { ... }          // 唯一的升级结算入口
function collectSoul(s, p) { ...; checkLevelUp(); }   // 正常路径
// 调试接口也调 checkLevelUp()
```

如果调试接口自己重写一遍循环，那测试测的就是副本 —— 正式路径坏了它照样绿。

---

## 四、单个游戏的阅读顺序

想快速看懂一个游戏，按这个顺序读：

1. **`<style>` 里的 CSS 变量** —— 一眼看出配色
2. **调参区的常量** —— 一眼看出这是什么类型的手感
3. **`#region CORE`** —— 核心规则全在这里，通常几十行
4. **`window.__GAME__`** —— 一眼看出这个游戏有哪些状态
5. 最后才是 `update()` 和 `render()`

前四步通常能覆盖 80% 的理解。渲染代码又长又琐碎，留到最后。

---

## 五、已知的取舍

| 取舍 | 原因 |
|---|---|
| 没有模块拆分，全部塞在一个文件里 | 单文件是这个项目的前提 —— 能直接双击打开、直接发给别人。代价是文件 400~500 行 |
| 用 `<script>` 而不是 `<script type="module">` | `type="module"` 在 `file://` 下会被 CORS 拦住，双击打不开 |
| 没有构建步骤 | 同上。源码就是产物 |
| 音效用 WebAudio 现场合成 | 外部音频文件会破坏单文件与离线两个前提 |
| 中文字体不内嵌 | 内嵌中文字体动辄几 MB，不如用系统字体 |
