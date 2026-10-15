# Reusable patterns

Everything here is shared across the five games, and every entry is something that actually cost time while building them.

Each one is written as **symptom → cause → fix**, because you cannot search for a problem before you have hit it.

---

## Contents

- [Time](#time)
- [Rendering](#rendering)
- [Input](#input)
- [Collision](#collision)
- [State](#state)
- [Levels and content](#levels-and-content)
- [Engineering](#engineering)
- [Localization](#localization)
- [Testing](#testing)
- [One meta-rule](#one-meta-rule)

---

## Time

### Fixed timestep with an accumulator

**Symptom.** Jumps feel right on your machine, but a friend on a 144 Hz display cannot clear the same gap.

**Cause.** Physics updates straight from the `dt` that `requestAnimationFrame` hands you. A different frame rate means different integration steps, and the error accumulates into something visible.

**Fix.**

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

**None of the three limits can be dropped:**

- `dt > 0.25` — switch to another tab for a minute and `dt` comes back enormous
- `steps < 16` — without it, one frame runs hundreds of updates and the player teleports through walls
- clearing `acc` when you hit the cap — catch up or give up; never let the debt compound

**Choosing the step.** 1/120 is plenty for pixel games. With 16 px tiles and a 520 px/s fall speed, one substep moves 4.3 px — safe. Faster than that and the collision function has to subdivide on its own.

### Frame-rate independent smoothing

**Symptom.** The camera follows differently after a refresh-rate change.

**Fix.** Exponential smoothing, not linear approach.

```js
// Wrong: scales with dt, so the feel changes with frame rate
x += (target - x) * 0.2;

// Right: exponential decay, frame-rate independent
x += (target - x) * (1 - Math.exp(-k * dt));
```

Higher `k` follows more tightly. Camera: 6–8. Paddle: around 20.

---

## Rendering

### Layered scaling: bitmap for the world, vectors for the UI

**Symptom.** The pixel art is sharp, but the small labels in the HUD are a blurry mess.

**Cause.** Everything is drawn into a low-resolution canvas and scaled up together. A 12 px label inside a 640×360 bitmap is only a few pixels wide — blown up, the strokes smear together. This hits CJK text especially hard.

**Fix.** Two layers, two scaling strategies.

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
cvs.style.width = (640 * s) + 'px';       // bitmap: integer CSS size
ui.style.transform = 'scale(' + s + ')';  // DOM: vector scaling
```

**Three details that are not optional:**

1. `s` must be an integer. A fractional scale puts pixels on half-pixel boundaries and they blur.
2. `transform-origin: 0 0` is required. The default origin is the element's centre, which is a different coordinate system from manual `left/top` centring — they fight each other.
3. **`image-rendering: pixelated` behaves inconsistently under CSS `transform` across browsers.** So the canvas uses a direct CSS size, never a transform. Only the vector DOM layer gets transformed.

### Precompute; do not allocate inside the render loop

**Symptom.** Frame rate collapses once there are enough particles.

**Fix.**

```js
// Light levels: look up, don't build strings every frame
const LIGHT_LEVELS = [];
for (let i = 0; i < 16; i++) {
  LIGHT_LEVELS.push('rgba(255,240,200,' + (i / 15 * 0.8).toFixed(3) + ')');
}
```

To check yourself: run real gameplay and assert `ctxCalls.createRadialGradient === 0`. A gradient created at runtime can almost always be pre-rendered.

### Compact in place instead of using filter

**Symptom.** Garbage every frame, GC stutter.

**Fix.**

```js
function prune(arr, isDead) {
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (!isDead(arr[i])) arr[n++] = arr[i];
  arr.length = n;
}
```

One less array allocation than `arr = arr.filter(...)`. Worth it anywhere that runs every frame.

**Caveat:** skip compaction during hitstop. The world is paused but entities are still in the array, and `enemies.length === 0` as a "wave cleared" check will fire late.

---

## Input

### Keyboard and pointer events land on different targets

**Symptom.** In tests, the mouse button is stuck down forever and every later assertion runs in a polluted state.

**Cause.** `keydown` is bound to `window`; `mousedown` is bound to the canvas. Your test harness has to dispatch to the right one.

**Fix.** Before writing the harness, list every `addEventListener` target in the source.

```js
const fireWin = (t, e) => (winListeners[t] || []).forEach(f => f(e));
const fireCanvas = (t, e) => (canvasEl.listeners[t] || []).forEach(f => f(e));
```

### Intent buffering: level sampling loses very short presses

**Symptom.** Players report "sometimes my click does nothing". You cannot reproduce it, because you hold keys longer than they do.

**Cause.** The attack check reads "is the button currently down". A trackpad tap or a very short press on a high-refresh display can last less than a frame and falls entirely between two samples.

**Fix.** Timestamp the press and let the *intent* survive briefly.

```js
const ATTACK_BUFFER = 0.15;
let buffer = 0;
onKeyDown(() => { buffer = ATTACK_BUFFER; });

function update(dt) {
  if (buffer > 0) buffer -= dt;
  if (buffer > 0 && cooldown <= 0) { attack(); buffer = 0; }
}
```

**Keep it short** (0.15–0.2 s) or you build up a "late swing". And **clear it the moment you leave the combat state** (menu opens, pause), or the player attacks once for no reason on return.

### The two jump leniencies

These are the difference between a platformer that feels good and one that does not:

| Mechanic | What it solves | Suggested |
|---|---|---|
| Coyote time | "I just walked off the edge and the jump did nothing" | 0.10 s |
| Jump buffer | "I pressed jump just before landing and nothing happened" | 0.12 s |

```js
if (G.buffer > 0) G.buffer -= dt;
if (G.coyote > 0) G.coyote -= dt;

if (G.buffer > 0 && (p.grounded || G.coyote > 0)) {
  p.vy = -JUMP_V;
  G.buffer = 0;
  G.coyote = 0;
}
if (p.grounded) G.coyote = COYOTE;      // refresh on landing
```

**Do not exceed 0.2 s.** Too generous and players feel the character jumping when they did not ask it to, which is worse than the original problem.

### Variable jump height: cut the rise exactly once

**Symptom.** A light tap barely lifts the character off the ground.

**Cause.** The cut is applied every frame instead of once.

```js
// Wrong: after release, every remaining rise frame multiplies by 0.42
if (!jumpHeld && vy < 0) vy *= 0.42;
```

There are a dozen rise frames left after release. Multiplying by 0.42 twelve times drives the velocity to nearly zero.

**Fix.** A flag so the cut happens once.

```js
if (!jumpHeld && p.vy < 0 && !p.jumpCut) {
  p.vy = cutJump(p.vy, JUMP_CUT);
  p.jumpCut = true;
}
// reset on takeoff: p.jumpCut = false
```

The arithmetic of a single 0.42 multiplication looks completely reasonable. This only shows up if you actually measure the jump height — so measure it.

---

## Collision

### Solve movement on one axis at a time

**Symptom.** Walking along a wall corner gets the character stuck, or jittering.

**Cause.** Solving x and y together. A diagonal step hits the wall face and the floor at once, and the solver cannot tell which way to push.

**Fix.** Resolve x, then y.

```js
moveX(box, level, vx * sdt);              // horizontal only
moveY(box, level, vy * sdt, prevBottom);  // vertical only
```

Each axis has exactly one way to push out, so they cannot conflict.

**Requirement.** A single step must move less than one tile, or you tunnel through thin walls:

```js
const steps = Math.max(1, Math.ceil(Math.max(Math.abs(vx), Math.abs(vy)) * dt / 4));
```

### Circle vs rectangle: use the closest point

Half the branches of edge-by-edge testing, and it handles the degenerate case — circle centre inside the rectangle — for free.

```js
function circleRect(cx, cy, r, rx, ry, rw, rh) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));   // closest point on the rect
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx, dy = cy - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 > r * r) return null;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, ny: dy / d, depth: r - d };
  }
  // Centre is inside: push out along the shallowest axis
  const left = cx - rx, right = rx + rw - cx;
  const top = cy - ry, bottom = ry + rh - cy;
  const m = Math.min(left, right, top, bottom);
  if (m === left)  return { nx: -1, ny: 0, depth: left + r };
  if (m === right) return { nx: 1, ny: 0, depth: right + r };
  if (m === top)   return { nx: 0, ny: -1, depth: top + r };
  return { nx: 0, ny: 1, depth: bottom + r };
}
```

Once you have the normal, push the ball out along it (`depth + 0.01`) **and then** reflect. **The push-out is not optional** — without it, the next substep hits the same object again.

### One-way platforms depend on the previous bottom edge

**Symptom.** Jumping up from below gets blocked (it acts like a ceiling), or standing on top falls through.

**Fix.** Carry the pre-move bottom edge into the check.

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

`prevBottom <= platform top` is the whole "did you come from above" test.

### Get the out-of-bounds rules right, especially below

**Symptom.** The player falls into a pit and does not die — they get stuck at the bottom.

**Cause.** `tileAt` returned solid for "below the level", usually justified as "don't fall out of the world". The real effect is an **invisible floor** spanning the entire underside of the level.

**Fix.**

```js
function tileAt(level, c, r) {
  if (r < 0) return EMPTY;                      // above: allow jumping off-screen
  if (r >= level.rows) return EMPTY;            // below: empty, let them fall out
  if (c < 0 || c >= level.cols) return SOLID;   // sides: the level's outer wall
  return level.grid[r][c];
}
```

Then the game layer decides "y past the bottom = death".

**What makes this one nasty is that tests will endorse it.** If your test says `out of bounds below is solid`, that becomes the spec. **When the spec is wrong, tests do not merely fail to help — they actively hide the problem.**

---

## State

### Make movement an immutable operation

**What you get for free:** undo, a solver, and replay.

```js
// Returns a new state; returns null if the move is impossible.
// Never mutates the state passed in.
function tryMove(state, dx, dy) {
  const nx = state.px + dx, ny = state.py + dy;
  if (isWall(state, nx, ny)) return null;

  const nk = key(nx, ny);
  if (state.boxes.has(nk)) {
    const bx = nx + dx, by = ny + dy;
    if (isWall(state, bx, by) || state.boxes.has(key(bx, by))) return null;
    const boxes = new Set(state.boxes);     // copy, don't touch the original
    boxes.delete(nk);
    boxes.add(key(bx, by));
    return { ...state, boxes, px: nx, py: ny, moves: state.moves + 1 };
  }
  return { ...state, px: nx, py: ny, moves: state.moves + 1 };
}
```

And then:

- **Undo** is pushing the old state onto a stack — no "reverse operation" to write
- **A solver** runs BFS directly on this function; the rules have exactly one implementation
- **Replay** is just the sequence of states

The alternative, `G.player.x += dx`, means writing all three of those separately — and three implementations will eventually disagree with the rules.

### Advance state before making decisions

**Symptom.** A stationary turret charges forever and never fires a shot.

**Cause.** The trigger check runs before the wind-up advance, so every frame resets the timer to full.

**Fix.** In `updateEnemy`, the order must be:

```
cooldown decay → special cycles → state advance (windup / strike / recover) → per-type decisions
```

### Bind state to the action, not to a timer

**Symptom.** For 0.15 s after a dash ends, the player cannot be hit — despite not dashing.

**Cause.** Invulnerability is a standalone 0.30 s timer while the dash displacement lasts 0.155 s.

**Fix.** Ask about the state directly.

```js
// Good: the predicate is the state itself
if (p.dashTime > 0) return;   // immune while dashing

// Bad: two similar-length timers that will drift apart
if (p.invuln > 0) return;
```

Better still, share one constant between the action duration and the immunity duration so they cannot drift structurally.

### Keep threshold checks out of the repaint cache

**Symptom.** Health drops from 30.1% to 29.9% (both display as "30") and the warning **does not** light up. It takes another hit.

**Cause.** To avoid writing styles every frame, the UI uses the rounded value as a repaint key. The threshold check lives inside that `if`, so the one hit that crossed the threshold is skipped.

**Fix.** Pull condition-driven presentation (warnings, flashes, state switches) out into its own per-frame boolean comparison. The cost is negligible.

### After adding a mechanic, ask whether its core actually runs

Visual polish — particles, auras, telegraph rings — is easy to get right while the damage resolution and state transitions never execute.

```
Looks like it is moving ≠ is actually taking effect
```

Concrete shapes this took in this project:

- A pickup got its icon, but nobody added it to `G.effects`, so the timer loop never touched it and it never worked
- A skill read its summon pool from a field that **never existed** on entities, so every boss fell through to the default and summoned the same minion. It did not error and the behaviour looked plausible — **because the fallback value happened to be the one that looks normal**

To guard against it: expose *which branch was taken* through the debug interface, and write an assertion for "the configuration actually took effect" rather than eyeballing whether the result looks right.

---

## Levels and content

### Levels as data, not code

```js
const LEVELS = [
  ['111111111111',
   '111111111111'],
];
```

"Add a level" becomes "type a few more lines", touching no logic.

**The cost is typo exposure**: inconsistent row widths, illegal characters, a missing spawn point. Every one of those needs an assertion behind it. (Here, `parseLevel` throws outright on a missing spawn or goal.)

### Gap widths must match the jump distance

```
horizontal jump ≈ max run speed × (2 × takeoff speed / gravity)
               = 168 × (2 × 428 / 1500) = 96 px = 6 tiles
```

The widest gap in the shipped levels is 5 tiles (80 px), leaving 16 px of margin.

**That number has to be machine-checkable.** Two mechanisms here:

1. `systems.test.mjs` asserts "widest gap ≤ jump distance"
2. `smoke.test.mjs` runs an autopilot through every level with real physics

The second is the more valuable one, because it also verifies the terrain is traversable, the physics parameters are sufficient, and the goal can actually be triggered.

### Make levels machine-verifiable

**This changes what level design is allowed to be, not just your test coverage.**

The "Crossing" level originally used 7–8 tile gaps, forcing the player to wait for a moving platform. That works as gameplay, but it carries a real cost: **an autopilot cannot "wait for the platform to drift over", so "is this level clearable" could only be answered by a human playing it**.

Narrowing the gaps to 5 tiles (jumpable) and demoting the platforms to "the easier route" let the autopilot clear all four levels, which means level design now has machine backing.

**Between "you must do it this way" and "it can be verified automatically", a project this size should pick the latter.**

### Moving platforms: derive position from time

Use a function of time, not accumulated displacement:

```js
function moverPos(m, t) {
  const off = Math.sin(t * m.speed + m.phase) * m.range;
  return m.axis === 'y' ? { x: m.x, y: m.y + off } : { x: m.x + off, y: m.y };
}
```

The position can be recomputed at any moment without drift from dropped frames, and the same `t` always yields the same position — which means it is testable.

**A player standing on a platform has to move with it:**

```js
// 1) Move the platforms first, recording each one's displacement this frame
for (const m of G.movers) { const prev = m.px; m.px = moverPos(m, time).x; m.dx = m.px - prev; }

// 2) A player standing on one inherits the same displacement
if (p.onMover) { p.x += p.onMover.dx; p.y += p.onMover.dy; }

// 3) Then handle input and collision
```

### Difficulty curve problems are usually distribution problems

Introduce a new enemy type at equal weight to the others and the average strength of that wave jumps off a cliff — measured at +95% in a single wave here.

**Stagger the introduction instead:**

```js
let spinnerWeight = 0;
if (wave >= 6) spinnerWeight = 0.34;      // full weight
else if (wave >= 4) spinnerWeight = 0.18; // first appearance, a small share
```

The same applies to boss phase thresholds, drop weights, and skill unlock pacing — **adjusting distribution beats adjusting numbers.**

---

## Engineering

### Three hard constraints of a single file

1. **No `<script type="module">`** — CORS blocks it under `file://`, so double-clicking would break
2. **No external resources whatsoever** — CDN, fonts, images, `fetch`. Otherwise "offline" is meaningless
3. **No build step** — the source *is* the artifact

There is a static check for all of these (`externalRefs()`), so they cannot erode quietly.

### Write `window.innerWidth`, not bare `innerWidth`

Value globals cannot be injected as parameters in a test environment — the injected value is frozen at startup and `resize` never sees the new one.

Function globals (`addEventListener`, `requestAnimationFrame`) *can* be injected, because their value never changes.

### Local storage must degrade

Private mode, some `file://` situations, and corporate policy all throw. Without a `try/catch`, the game dies at the save step — precisely when the player just had a great run and most wants it kept.

```js
function storageSet(key, value) {
  memStore[key] = String(value);                       // memory first
  try { window.localStorage.setItem(key, String(value)); } catch (e) { /* degraded */ }
}
```

### Seeded randomness

**All game logic goes through a seeded RNG. Only presentation uses true randomness.**

```js
// Logic: reproducible
const rng = makeRNG(seed);

// Presentation: screen shake, audio noise, the starting seed itself → Math.random is fine
ctx.translate((Math.random() - 0.5) * shake, ...);
```

Two benefits: tests stop going red because of one lucky or unlucky roll, and "the same seed replays the whole run" becomes a feature you can offer players.

**How to verify it:** same seed + same inputs → identical ball trajectory frame by frame. Different seed → different trajectory.

### Event-driven logic belongs in the event

**Symptom.** Killing a boss should open the door, but when the kill also pops the upgrade panel, the door never opens.

**Cause.** The door logic lives in a stage of the main loop, and the panel made `update` return early, so the scheduler never reached it.

**Fix.** Anything that must take effect *the moment something happens* should be called directly from the event handler. Per-frame scheduling is a fallback, not the mechanism.

### A hidden overlay still catches clicks

**Symptom.** Clicking the middle of the screen during a fight restarts the run.

**Cause.** The parent has `pointer-events: none`, but **that does not stop children**. A button inside the hidden panel declares `pointer-events: auto` and remains in hit-testing.

**Fix.** Two layers of defence.

```css
/* 1) Deactivate the whole subtree */
.overlay:not(.on) * { pointer-events: none; }
```

```js
// 2) And wrap every button in a state guard
btn.onclick = () => {
  if (G.state !== 'menu') return;   // panel isn't up; ignore
  startRun();
};
```

Now even a broken stylesheet cannot cause a mis-tap. This class of bug is only visible on a real device; tests cannot see it at all.

### Fallbacks should not override an explicitly expressed zero

`Math.max(1, ...)` as a damage floor means "no hit should be completely null", but it also makes a debug multiplier of ×0 deal 1 damage.

The predicate should be "apply the floor only when the raw value is > 0", not a hardcoded floor. The same reasoning applies to minimum movement speed and minimum attack interval — **for any fallback, ask what the caller means by passing zero.**

### When the fallback value is plausible, the defect goes invisible

A "read from the entity, fall back to a default" branch hides forever if the default happens to be the one that looks right.

To guard against it: **expose which branch was taken through the debug interface**, and assert "the configuration took effect" rather than judging by whether the outcome looks plausible.

---

## Localization

### Ship both languages inside one file

**The tempting alternative:** a second file, `game.en.html`.

**Why not.** Two files to maintain by hand means a bug fixed in one and not the other, and nothing detects the divergence. Keeping both languages in the same file means they share one set of logic and only the text is separated — and it lets a test assert that the two key sets match exactly.

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

**A missing key returns the key itself.** That is deliberate: a typo shows up on screen as `over.titel` instead of silently rendering `undefined`.

### Detection order: URL → stored choice → browser

```js
function detectLang() {
  // 1) URL parameter — highest priority, so a link can pin the language
  const m = (window.location && window.location.search || '').match(/[?&]lang=(zh|en)\b/);
  if (m) return m[1];

  // 2) Last explicit choice — must be readable or a refresh jumps back
  const saved = window.localStorage.getItem('sfpg.lang');
  if (saved === 'zh' || saved === 'en') return saved;

  // 3) Browser language
  const tag = (window.navigator || {}).language || '';
  return /^zh\b/i.test(tag) ? 'zh' : 'en';
}
```

Every step is wrapped in `try/catch`. `location` can be restricted under `file://`, and `localStorage` throws in private mode — **a language check must never be the thing that stops the game from starting.**

### Remember the message, not the rendered string

**Symptom.** Press `L` during the opening screen and the start panel does not change. Press it during the game-over panel and it does. Only one screen is broken.

**Cause.** The overlay helper stored the *rendered* text, and the start screen's `overlayKeys` was initialized to `null` — so the repaint had nothing to re-render and returned early.

**Fix.** Store keys and parameters, then repaint from them:

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

Now switching language is one call, and no call site needs its own refresh logic. **The bug only affected one screen**, which is why it survived casual testing.

### Assert the key sets match

A missing translation is a silent failure: the interface just shows the other language in one spot, or the key name itself.

```js
const missingInEn = zhKeys.filter(k => !(k in enPairs));
ok(missingInEn.length === 0, 'the English table is missing no keys', missingInEn.join(', '));
```

Do the same for placeholders. A language that loses `{score}` renders a sentence with a hole in it:

```js
const ph = s => (s.match(/\{(\w+)\}/g) || []).sort().join(',');
if (ph(zhPairs[k]) !== ph(enPairs[k])) mismatch.push(k);
```

### A mock's `documentElement` has to be the same node

**Symptom.** The game sets `<html lang>` and the test reads back `null`.

**Cause.** The mock built `document.documentElement` as a **separate object** from the one behind `getElementById('html')`. In a real browser they are the same node.

**Fix.**

```js
const documentMock = {
  getElementById: id => getEl(id),
  get documentElement() { return getEl('html'); },
  get body() { return getEl('body'); },
};
```

Worth generalizing: **any time the mock has two ways to reach the same thing, they must return the same object.** Otherwise the test is measuring the mock, not the code.

### Language switching must not touch game state

Switching text is a presentation change. Assert that it is one:

```js
const before = { state, score, dir, head: JSON.stringify(body[0]) };
env.key('L');
const after  = { state, score, dir, head: JSON.stringify(body[0]) };
ok(JSON.stringify(before) === JSON.stringify(after), 'switching language changes no game state');
```

This catches the "while I was in there I also reset something" class of mistake, which manual testing essentially never finds.

---

## Testing

### A mock DOM needs a static check alongside it

Mocks usually **create any element on demand** when `getElementById` is called. That makes tests easy to write, and it means "referenced an element that does not exist" can never surface — until you open the file in a real browser.

```js
// Static check: every id the JS references must be declared in the HTML
const declared = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const referenced = new Set([...script.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)].map(m => m[1]));
const missing = [...referenced].filter(id => !declared.has(id));
```

### Interface strings need a static check too

The mock does not parse `innerHTML`, so unclosed tags and misspelled class names never show up.

**Do not check literal by literal** — interface strings are almost always concatenated:

```js
'Score <span class="keys">' + n + '</span> remaining'
```

The `<span>` and the `</span>` are in different literals, so a per-literal comparison is guaranteed to produce false positives. Cut out the entire call by bracket balance first, then compare across all the literals inside it.

### Snapshot objects with a deep copy

```js
// Wrong: this is a live reference; the comparison will always hold
const before = GAME.upgradeLevels();

// Right
const before = JSON.parse(JSON.stringify(GAME.upgradeLevels()));
// or, for a simple object
const before = { ...GAME.player() };
```

**The assertion passes forever and tests nothing.** This project tripped over it with `p0.x > p1.x`.

### Clear input state between tests

A stress test often ends with an arrow key still held; the next test's player then drifts in that direction forever, producing **false failures that look like broken features** — "the target isn't where it should be", "the dash went the wrong way".

Put "release every key and lift the mouse" into the per-test isolation helper. It costs almost nothing.

### Do not transcribe a second copy of the truth

Rewriting the game's numeric curve in the test (`1 + (f-1)*0.20`) looks like independent verification. What it actually produces is "you changed the game's numbers and the assertion still tests the old curve" — **and everything is green while it is a lie.**

Query the game instead:

```js
// Good: ask the game
const mul = f => E.enemyHpAt(f, 'crawler') / E.enemyHpAt(1, 'crawler');

// Bad: a second copy
const mul = f => 1 + (f - 1) * 0.20;
```

### Stay out of the saturation region

```js
// Wrong: with cap=2, 1 + hits*0.012 saturates around hits≈84
ok(speedMultiplier(100, 2) < speedMultiplier(200, 2));   // both are 2

// Right: sample on either side of saturation
ok(speedMultiplier(10, 2) < speedMultiplier(30, 2));
ok(speedMultiplier(200, 2) === speedMultiplier(400, 2));
```

**Sample points have to account for the implementation's curve**, or you end up testing something else — the assertion above was actually testing clamping, not monotonicity.

### Self-check: does the static checker work at all?

A checker that always passes is not a check. Give it synthetic input:

```js
const fakeHtml = '<div id="a"></div>';
const fakeScript = "document.getElementById('c');";
const missing = [...referencedIds(fakeScript)].filter(id => !declaredIds(fakeHtml).has(id));
ok(missing.length === 1, 'synthetic sample: an undeclared id reference is caught');
```

Equally important: **verify that your guards actually block.** Plant a violation, confirm it reports, then remove it. That is exactly how the privacy guard in this project was validated — and its probe caught a real leak the first time it ran.

### Probes for a test environment should not go through the shell

Git Bash's `printf` and heredocs eat backslashes (`C:\Users` → `C://Users`). This once produced a false "the guard missed this" verdict — the probe file had been mangled by the shell, not by the guard.

**Write probes that contain backslashes in a scripting language, not via shell redirection.**

### `cmd | tail -N && echo OK` swallows the exit code

After a pipe, `&&` tests `tail`'s exit status, not `cmd`'s. This once reported a failed build as a success.

Either drop the pipe, or read `"${PIPESTATUS[0]}"` explicitly.

### Count on transitions, not on every frame

```js
// Wrong: counts once per frame for as long as the state lasts
if (state === 'dead') deaths++;

// Right: counts once, at the moment of entry
if (state === 'dead' && prevState !== 'dead') deaths++;
prevState = state;
```

Otherwise "died 320 times in 1500 frames" shows up in a report and you spend an hour working out why.

---

## One meta-rule

Every trap above shares one property: **it all looks fine.**

- A jump cut applied every frame — multiplying once by 0.42 is completely reasonable
- An invisible floor at the bottom of a level — "don't fall out of the world" is a legitimate-sounding reason
- Level-sampled input — you hold keys long enough that you will never reproduce it
- A fallback that happens to be plausible — the defect hides inside a branch that looks correct

**So "it seems to run" is not an acceptance criterion.** Write down as specification only what a machine can verify; for anything that cannot be verified, mark it honestly as unverified.
