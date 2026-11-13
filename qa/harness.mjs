import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const site = resolve(import.meta.dirname, '../dist');

export function loadGame(saved = {}, options = {}) {
  const errors = [];
  const window = new Window({
    url: options.url || 'http://localhost/', width: 1440, height: 1000,
    settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true, enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true }
  });
  window.addEventListener('error', event => { errors.push(event.error || event.message); event.preventDefault(); });
  for (const [key, value] of Object.entries(saved)) window.localStorage.setItem(key, value);
  const sourceHtml = options.html ?? readFileSync(resolve(site, 'index.html'), 'utf8');
  const scripts = [...sourceHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/script>/gi)].map(match => match[1]);
  const html = sourceHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
  window.document.write(html);
  window.document.close();

  let now = 0, nextId = 1;
  const raf = new Map(), timers = new Map(), observers = [];
  // happy-dom windows share Node's Performance object. Shadow it per window;
  // mutating its now() would reset another restored window's race clock.
  Object.defineProperty(window, 'performance', { configurable: true, value: Object.create(window.performance, { now: { configurable: true, value: () => now } }) });
  const origin = Date.parse('2026-11-04T05:00:00.000Z');
  const NativeDate = window.Date;
  window.Date = class extends NativeDate { static now() { return origin + now; } };
  window.requestAnimationFrame = fn => { const id = nextId++; raf.set(id, fn); return id; };
  window.cancelAnimationFrame = id => raf.delete(id);
  window.setTimeout = (fn, delay = 0, ...args) => { const id = nextId++; timers.set(id, { fn, due: now + Number(delay), args, interval: 0 }); return id; };
  window.setInterval = (fn, delay = 0, ...args) => { const id = nextId++; timers.set(id, { fn, due: now + Number(delay), args, interval: Math.max(1, Number(delay)) }); return id; };
  window.clearTimeout = window.clearInterval = id => timers.delete(id);
  window.ResizeObserver = class { constructor(callback) { this.callback = callback; } observe(target) { observers.push(() => this.callback([{ target }])); } unobserve() {} disconnect() {} };
  window.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 500, width: 800, height: 500, toJSON() {} }; };
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.HTMLElement.prototype.scrollTo = function ({ top = 0 } = {}) { this.scrollTop = top; };
  if (window.HTMLDialogElement) {
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  }
  options.beforeScripts?.(window);
  for (const filename of scripts) {
    if (!/^[a-z0-9.-]+\.js$/i.test(filename)) throw Error(`Unexpected script path ${filename}`);
    // Tests never reach the real Firebase: without its config, rooms use the BroadcastChannel.
    const offline = filename === 'room-config.js' ? 'window.VIT_DUA_FIREBASE = null;' : null;
    window.eval(options.scripts?.[filename] ?? offline ?? readFileSync(resolve(site, filename), 'utf8'));
  }
  observers.forEach(fn => fn());

  const $ = id => window.document.getElementById(id);
  const advance = (milliseconds, step = 100) => {
    const end = now + milliseconds;
    while (now < end) {
      now = Math.min(end, now + step);
      let guard = 1000;
      while (guard--) {
        const due = [...timers].filter(([, timer]) => timer.due <= now).sort((a, b) => a[1].due - b[1].due)[0];
        if (!due) break;
        const [id, timer] = due;
        if (timer.interval) timer.due += timer.interval; else timers.delete(id);
        if (typeof timer.fn === 'function') timer.fn(...timer.args); else window.eval(String(timer.fn));
      }
      if (guard < 0) throw Error('Timer loop did not settle.');
      const callbacks = [...raf.values()]; raf.clear();
      callbacks.forEach(fn => fn(now));
    }
  };
  const click = selector => {
    const element = selector.startsWith('#') || selector.includes('[') || selector.includes('.') ? window.document.querySelector(selector) : $(selector);
    if (!element) throw Error(`Missing control ${selector}`);
    if (element.disabled) throw Error(`Disabled control ${selector}`);
    element.click();
    return element;
  };
  const fill = (id, value) => { const element = $(id); if (!element) throw Error(`Missing input ${id}`); element.value = value; element.dispatchEvent(new window.Event('input', { bubbles: true })); element.dispatchEvent(new window.Event('change', { bubbles: true })); };
  const storage = () => Object.fromEntries(Array.from({ length: window.localStorage.length }, (_, index) => { const key = window.localStorage.key(index); return [key, window.localStorage.getItem(key)]; }));
  return { window, $, click, fill, advance, errors, storage, raf, timers, now: () => now, close: () => window.happyDOM.abort() };
}
