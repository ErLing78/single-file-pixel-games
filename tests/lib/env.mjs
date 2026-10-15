/**
 * env.mjs — 无头浏览器环境，用于在 Node 里真实执行这些单文件游戏。
 *
 * 这不是"单元测试替身"。它真的把游戏脚本跑起来：主循环、事件、渲染调用
 * 全部发生，只是 canvas 调用被一笔笔记下来而不是画到屏幕上。
 *
 * 核心约定：
 *   · rAF 与 setTimeout 都是手动排程 —— 同步 for 循环里也能精确推进时间
 *   · Canvas 上下文用 Proxy 兜底，任何链式调用都不会抛异常
 *   · getElementById 会自动创建元素 —— 这一条很方便，但也意味着
 *     "JS 引用了不存在的 id" 这类错误在这里永远暴露不出来。
 *     所以必须另配 tests/dom-check.mjs 做静态一致性检查，别偷懒。
 */

/** 万能对象：让任意深度的链式 Canvas 调用都不炸 */
function makeAny() {
  return new Proxy(function () {}, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'toString') return () => '[mock]';
      if (k === 'length') return 0;
      if (k === 'tagName') return 'DIV';
      return makeAny();
    },
    set() { return true; },
    apply() { return makeAny(); },
  });
}

/**
 * 一个可以预置内容、也可以模拟"不可用"的 localStorage。
 *
 * 真实环境里 localStorage 会在隐私模式或某些 file:// 场景下抛异常。
 * 游戏必须能降级，所以 here 提供了 failMode 来复现那种情况。
 */
export function createStorage({ seed = {}, failMode = false } = {}) {
  const data = { ...seed };
  const api = {
    getItem(k) {
      if (failMode) throw new DOMException('storage disabled', 'SecurityError');
      return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
    },
    setItem(k, v) {
      if (failMode) throw new DOMException('storage disabled', 'SecurityError');
      data[k] = String(v);
    },
    removeItem(k) {
      if (failMode) throw new DOMException('storage disabled', 'SecurityError');
      delete data[k];
    },
    clear() {
      if (failMode) throw new DOMException('storage disabled', 'SecurityError');
      for (const k of Object.keys(data)) delete data[k];
    },
    get length() { return Object.keys(data).length; },
    key(i) { return Object.keys(data)[i] ?? null; },
    /** 测试用：直接看底层内容，绕过可能的异常 */
    _dump() { return { ...data }; },
  };
  return api;
}

export function createMockEnv(opts = {}) {
  const viewW = opts.viewW || 640;
  const viewH = opts.viewH || 360;
  const stepMs = opts.stepMs || 1000 / 60;
  const onText = opts.onText || null;          // (id, value) => void，用来观察 HUD
  const storage = opts.storage || createStorage();
  const sessionStorageMock = createStorage();  // 独立一份，别和 localStorage 串味

  /* ---------- canvas 上下文 ---------- */
  const ctxCalls = Object.create(null);
  let drawCalls = 0;
  function makeCtx(canvas) {
    const store = { canvas };
    return new Proxy(store, {
      get(t, k) {
        if (k in t) return t[k];
        if (typeof k === 'symbol') return makeAny();
        const fn = function () {
          drawCalls++;
          ctxCalls[k] = (ctxCalls[k] || 0) + 1;
          if (/^create(Radial|Linear)Gradient$|^createPattern$/.test(k)) return makeAny();
          if (k === 'getImageData') {
            return { data: new Uint8ClampedArray(4), width: 1, height: 1 };
          }
          if (k === 'measureText') return { width: 10 };
          return undefined;
        };
        t[k] = fn;
        return fn;
      },
      set(t, k, v) { t[k] = v; return true; },
    });
  }

  /* ---------- 元素 ---------- */
  const els = {};
  function makeEl(tag, id) {
    const el = {
      tagName: String(tag).toUpperCase(),
      id: id || '',
      width: viewW,
      height: viewH,
      style: {},
      children: [],
      onclick: null,
      _text: '',
      _html: '',
      classList: {
        _s: new Set(),
        add(c) { this._s.add(c); },
        remove(c) { this._s.delete(c); },
        toggle(c, on) {
          if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
          else { on ? this._s.add(c) : this._s.delete(c); }
        },
        contains(c) { return this._s.has(c); },
      },
      listeners: {},
      attributes: {},
      addEventListener(t, fn) { (el.listeners[t] = el.listeners[t] || []).push(fn); },
      removeEventListener() {},
      setAttribute(k, v) { el.attributes[k] = String(v); },
      getAttribute(k) {
        return Object.prototype.hasOwnProperty.call(el.attributes, k) ? el.attributes[k] : null;
      },
      hasAttribute(k) { return Object.prototype.hasOwnProperty.call(el.attributes, k); },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: viewW, height: viewH, right: viewW, bottom: viewH };
      },
      appendChild(c) { el.children.push(c); return c; },
      removeChild(c) {
        const i = el.children.indexOf(c);
        if (i >= 0) el.children.splice(i, 1);
        return c;
      },
      click() { if (el.onclick) el.onclick({ preventDefault() {}, target: el }); },
      getContext() { return makeCtx(el); },
      querySelector() { return null; },
      focus() {},
      blur() {},
    };
    Object.defineProperty(el, 'textContent', {
      get() { return el._text; },
      set(v) { el._text = String(v); if (onText) onText(id, v); },
    });
    Object.defineProperty(el, 'innerHTML', {
      get() { return el._html; },
      set(v) { el._html = String(v); el.children.length = 0; },
    });
    return el;
  }
  const getEl = id => (els[id] = els[id] || makeEl('div', id));

  const documentMock = {
    getElementById: id => getEl(id),
    createElement: tag => makeEl(tag),
    addEventListener() {},
    /* html / body 必须走同一张元素表。
       早先这里是 makeEl('html', 'html') —— 独立创建的对象，
       于是游戏在 document.documentElement 上 setAttribute('lang', ...)，
       测试去 getEl('html') 读却什么也读不到。真实浏览器里
       documentElement 和 getElementById('html') 是同一个节点，mock 要一致。 */
    get documentElement() { return getEl('html'); },
    get body() { return getEl('body'); },
  };

  /* ---------- window / rAF / setTimeout ---------- */
  const winListeners = {};
  let nowMs = 0;
  let rafCb = null;
  let rafCount = 0;
  const timers = [];

  const windowMock = {
    innerWidth: viewW * 2,
    innerHeight: viewH * 2,
    devicePixelRatio: 1,
    addEventListener(t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); },
    removeEventListener() {},
    localStorage: storage,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: cb => { rafCb = cb; rafCount++; return rafCount; },
    setTimeout: (fn, ms) => { timers.push({ fn, at: nowMs + (ms || 0) }); return timers.length; },
    /* 语言检测要用到这两个。默认给中文（项目的原始语言），
       测试可以通过 opts.locale / opts.lang 覆盖，来验证检测顺序。 */
    navigator: {
      language: opts.locale || 'zh-CN',
      languages: [opts.locale || 'zh-CN'],
    },
    location: {
      search: opts.search || '',
      href: 'file:///games/test.html' + (opts.search || ''),
    },
  };

  const perfMock = { now: () => nowMs };
  const rafMock = cb => { rafCb = cb; rafCount++; return rafCount; };
  const cancelRafMock = () => { rafCb = null; };
  const setTimeoutMock = (fn, ms) => { timers.push({ fn, at: nowMs + (ms || 0) }); return timers.length; };
  const clearTimeoutMock = () => {};
  const intervalMock = (fn, ms) => { timers.push({ fn, at: nowMs + (ms || 0), repeat: ms || 0 }); return timers.length; };
  const clearIntervalMock = () => {};

  /* ---------- 注入给游戏脚本的浏览器全局 ----------
   * 浏览器里 addEventListener 是全局函数，但在 new Function 的作用域里
   * 它并不存在。要么让每个游戏都写成 window.addEventListener，
   * 要么在这里把全局补齐 —— 选后者，因为裸写的 addEventListener
   * 才是正常的浏览器代码，测试环境不该反过来逼迫源码变形。
   *
   * 注意这里只注入"函数型"全局。值型全局（innerWidth 等）以参数形式
   * 注入会被快照定格，resize 之后取不到新值，所以游戏里统一写
   * window.innerWidth —— 这本来也是更规范的写法。
   */
  const injected = {};
  const bind = (name, fn) => { injected[name] = (...a) => fn(...a); };
  bind('addEventListener', (t, fn) => windowMock.addEventListener(t, fn));
  bind('removeEventListener', (t, fn) => windowMock.removeEventListener(t, fn));
  bind('requestAnimationFrame', rafMock);
  bind('cancelAnimationFrame', cancelRafMock);
  bind('setTimeout', setTimeoutMock);
  bind('clearTimeout', clearTimeoutMock);
  bind('setInterval', intervalMock);
  bind('clearInterval', clearIntervalMock);

  /* ---------- 事件派发 ----------
   * 注意两种目标：键盘在 window 上，指针在 canvas 上。
   * 源码里监听在哪，这里就必须派发到哪 —— 派错目标的表现是
   * "输入状态永远卡在按下"，后续所有测试都会在污染状态下跑，
   * 症状看起来像功能坏了，实际是测试自己造成的。
   */
  const fireWin = (t, e) => (winListeners[t] || []).forEach(f => f(e));
  const fireCanvas = (t, e) =>
    ((els.world && els.world.listeners[t]) || []).forEach(f => f(e));

  const api = {
    window: windowMock,
    document: documentMock,
    elements: els,
    storage,
    getEl,
    get drawCalls() { return drawCalls; },
    get ctxCalls() { return ctxCalls; },
    get now() { return nowMs; },
    get rafCount() { return rafCount; },
    get timers() { return timers; },

    /** 执行页面里的游戏脚本 */
    run(code) {
      // 用一个对象承载所有要注入的全局，键名天然去重 ——
      // 之前分成"显式列表 + 注入对象"两处，结果 requestAnimationFrame
      // 和 setTimeout 各出现两次，new Function 直接抛
      // "Duplicate parameter name"，游戏一行都跑不起来。
      const provided = {
        window: windowMock,
        document: documentMock,
        requestAnimationFrame: rafMock,
        performance: perfMock,
        setTimeout: setTimeoutMock,
        localStorage: storage,
        sessionStorage: sessionStorageMock,
        AudioContext: undefined,      // 故意缺席：游戏必须静默降级
        webkitAudioContext: undefined,
        fetch: undefined,             // 静态检查已禁止，这里再兜一层
        alert: () => {},
        console: console,
        ...injected,
      };
      const names = Object.keys(provided);
      // eslint-disable-next-line no-new-func
      const fn = new Function(...names, code);
      fn(...names.map(n => provided[n]));
      return this;
    },

    /** 同步推进 n 帧：先结算到期的 setTimeout，再调用 rAF 回调 */
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        nowMs += stepMs;
        for (let j = timers.length - 1; j >= 0; j--) {
          const t = timers[j];
          if (t.at <= nowMs) {
            if (t.repeat) t.at = nowMs + t.repeat;   // setInterval 要留在表里
            else timers.splice(j, 1);
            t.fn();
          }
        }
        const cb = rafCb;
        rafCb = null;
        if (!cb) throw new Error('rAF 回调在第 ' + i + ' 帧丢失，主循环已中断');
        cb(nowMs);
      }
      return this;
    },

    key(k) {
      fireWin('keydown', { key: k, preventDefault() {} });
      fireWin('keyup', { key: k, preventDefault() {} });
      return this;
    },
    keyDown(k) { fireWin('keydown', { key: k, preventDefault() {} }); return this; },
    keyUp(k) { fireWin('keyup', { key: k, preventDefault() {} }); return this; },

    mouse(type, ev) { fireCanvas(type, ev || {}); return this; },

    /** 把按键状态清空，避免测试之间互相污染 */
    releaseAll() {
      for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
                       'a', 'd', 'w', 's', 'A', 'D', 'W', 'S',
                       ' ', 'Escape', 'Enter', 'z', 'Z', 'r', 'R',
                       'Shift', '1', '2', '3']) {
        fireWin('keyup', { key: k, preventDefault() {} });
      }
      fireCanvas('mouseup', {});
      return this;
    },
  };
  return api;
}

/** 极简断言器：四套测试共用同一套输出风格 */
export function createReporter(title) {
  let pass = 0, fail = 0;
  const failures = [];
  const line = () => console.log('─'.repeat(62));

  console.log('\n' + '█ ' + title);
  return {
    group(t) { console.log('\n▌ ' + t); },
    ok(cond, name, extra) {
      if (cond) {
        pass++;
        console.log('  ✓ ' + name + (extra ? '   ' + extra : ''));
      } else {
        fail++;
        failures.push(name);
        console.log('  ✗ ' + name + (extra ? '   → ' + extra : ''));
      }
    },
    note(t) { console.log('  · ' + t); },
    get pass() { return pass; },
    get fail() { return fail; },
    finish() {
      console.log('');
      line();
      if (fail === 0) {
        console.log('✓ 全部通过：' + pass + ' 项');
      } else {
        console.log('✗ ' + fail + ' 项失败 / 共 ' + (pass + fail) + ' 项');
        failures.forEach(f => console.log('   - ' + f));
      }
      line();
      return fail === 0;
    },
  };
}
