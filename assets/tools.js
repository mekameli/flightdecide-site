/* FlightDecide — shared behavior for /tools/ pages: steppers, dial drag, result pulses, FAQ */
(function () {
  'use strict';
  window.FD = window.FD || {};

  /* Steppers: tap to bump, press-and-hold to repeat. Dispatches 'input' so page compute() runs. */
  function initSteppers(root) {
    (root || document).querySelectorAll('.stepper').forEach(function (st) {
      const input = st.querySelector('input');
      if (!input || st.dataset.init) return;
      st.dataset.init = '1';
      const step = parseFloat(st.dataset.step || input.step || 1) || 1;
      function bump(dir) {
        const min = input.min !== '' ? parseFloat(input.min) : -Infinity;
        const max = input.max !== '' ? parseFloat(input.max) : Infinity;
        let v = parseFloat(input.value);
        if (isNaN(v)) v = parseFloat(input.placeholder) || 0;
        v = Math.min(max, Math.max(min, v + dir * step));
        input.value = Math.round(v * 100) / 100;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const fieldLabel = (function () {
        const host = st.closest('.calc-field');
        const l = host && host.querySelector('label');
        return l ? l.textContent.trim().replace(/\s+/g, ' ') : '';
      })();
      st.querySelectorAll('button').forEach(function (btn) {
        const dir = btn.classList.contains('step-up') ? 1 : -1;
        if (fieldLabel) btn.setAttribute('aria-label', (dir > 0 ? 'Increase ' : 'Decrease ') + fieldLabel);
        let t = null, iv = null;
        function stop() { clearTimeout(t); clearInterval(iv); t = iv = null; }
        btn.addEventListener('pointerdown', function (e) {
          e.preventDefault();
          bump(dir);
          t = setTimeout(function () { iv = setInterval(function () { bump(dir); }, 70); }, 450);
        });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
          btn.addEventListener(ev, stop);
        });
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          // keyboard activation (Enter/Space) never went through pointerdown
          if (e.detail === 0) bump(dir);
        });
      });
    });
  }
  FD.initSteppers = initSteppers;
  initSteppers(document);

  /* Dial drag: rotate a compass group by dragging; writes degrees into the input. */
  FD.dial = function (svg, group, input, snap) {
    snap = snap || 5;
    group.style.cursor = 'grab';
    group.style.touchAction = 'none';
    group.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (svg.setPointerCapture) { try { svg.setPointerCapture(e.pointerId); } catch (err) {} }
      svg.classList.add('dragging');
      function angleOf(ev) {
        const r = svg.getBoundingClientRect();
        const x = ev.clientX - (r.left + r.width / 2);
        const y = ev.clientY - (r.top + r.height / 2);
        let a = Math.atan2(x, -y) * 180 / Math.PI;
        a = Math.round(a / snap) * snap;
        a = ((a % 360) + 360) % 360;
        return a === 0 ? 360 : a;
      }
      function move(ev) {
        input.value = angleOf(ev);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      move(e);
      function up() {
        svg.classList.remove('dragging');
        svg.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      }
      svg.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  };

  /* Result pulse: any .result-value that changes gets a quick scale pop. */
  const pulsed = new WeakSet();
  const obs = new MutationObserver(function (muts) {
    const hit = new Set();
    muts.forEach(function (m) {
      let el = m.target.nodeType === 3 ? m.target.parentElement : m.target;
      while (el && el !== document.body) {
        if (el.classList && el.classList.contains('result-value')) { hit.add(el); break; }
        el = el.parentElement;
      }
    });
    hit.forEach(function (el) {
      el.classList.remove('pulse');
      void el.offsetWidth;
      el.classList.add('pulse');
    });
  });
  function watchResults() {
    document.querySelectorAll('.result-value').forEach(function (el) {
      if (pulsed.has(el)) return;
      pulsed.add(el);
      obs.observe(el, { childList: true, characterData: true, subtree: true });
    });
  }
  // defer one tick so the page's initial compute() paints without a pulse storm
  setTimeout(watchResults, 250);

  /* METAR helpers */
  FD.parseMetarWind = function (text) {
    const m = String(text).toUpperCase().match(/\b(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?KT\b/);
    if (!m) return null;
    return {
      dir: m[1] === 'VRB' ? null : parseInt(m[1], 10),
      speed: parseInt(m[2], 10),
      gust: m[3] ? parseInt(m[3], 10) : null
    };
  };

  /* Cross-tool value sharing: a value computed or entered on one tool page is
     offered as a one-tap prefill on another. Nothing is auto-applied; the pilot
     taps the chip to accept. Persisted in localStorage so it survives the
     navigation between separate tool pages (mirrors the iOS ToolInputStore). */
  FD.shared = (function () {
    const KEY = 'fd.tools.shared.v1';
    // quantity -> display + tolerance. `deg` quantities render "310" with a
    // trailing degree sign and no space.
    const META = {
      tasKt: { unit: 'kt', dec: 0, tol: 0.5 },
      groundspeedKt: { unit: 'kt', dec: 0, tol: 0.5 },
      altimeterInHg: { unit: 'inHg', dec: 2, tol: 0.005 },
      oatC: { unit: '°C', dec: 0, tol: 0.5 },
      windDirDeg: { unit: '°', dec: 0, tol: 0.5, deg: true },
      windSpeedKt: { unit: 'kt', dec: 0, tol: 0.5 },
      magVarDeg: { unit: '°', dec: 0, tol: 0.5, deg: true },
      fuelFlowGph: { unit: 'gph', dec: 1, tol: 0.05 },
      distanceNm: { unit: 'NM', dec: 0, tol: 0.5 }
    };
    function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
    function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }
    function match(q, a, b) { return isFinite(a) && isFinite(b) && Math.abs(a - b) <= META[q].tol; }
    function round(q, v) { const p = Math.pow(10, META[q].dec); return Math.round(v * p) / p; }
    function fmt(q, v) {
      const m = META[q];
      const n = m.dec > 0 ? v.toFixed(m.dec) : String(Math.round(v));
      return m.deg ? n + m.unit : n + ' ' + m.unit;
    }
    return {
      meta: META, fmt: fmt, round: round,
      // Record a value produced by `toolId`. No-ops on non-finite / unchanged.
      publish: function (q, value, toolId, toolName) {
        if (!META[q] || !isFinite(value)) return;
        const o = load(), e = o[q];
        if (e && e.t === toolId && match(q, e.v, value)) return;
        o[q] = { v: value, t: toolId, n: toolName, at: Date.now() };
        save(o);
      },
      // The value another tool could adopt: present, from a different tool, and
      // meaningfully different from `current`. Returns {v,t,n} or null.
      suggest: function (q, current, toolId) {
        const o = load(), e = o[q];
        if (!e || e.t === toolId) return null;
        if (match(q, e.v, current)) return null;
        return e;
      }
    };
  })();

  /* Render a subtle "Use 142 kt (from True Airspeed)" chip under an input when a
     fresher value from another tool exists. Tapping it fills the field.
     `opts.read` / `opts.write` let a page whose control is not a single signed
     number (e.g. a magnitude paired with an E/W select) map to the shared value;
     `opts.label` overrides how the offered value reads on the chip. All three
     default to the plain input. Returns the refresh function so a caller can
     re-run it when a companion control changes. */
  FD.attachPrefill = function (input, quantity, toolId, toolName, opts) {
    if (!input || !FD.shared.meta[quantity]) return;
    const host = input.closest('.calc-field') || input.parentElement;
    if (!host) return;
    const read = (opts && opts.read) || function () { return parseFloat(input.value); };
    const write = (opts && opts.write) || function (v) { input.value = v; };
    const label = (opts && opts.label) || function (v) { return FD.shared.fmt(quantity, v); };
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'prefill-chip';
    chip.hidden = true;
    host.appendChild(chip);
    function refresh() {
      const s = FD.shared.suggest(quantity, read(), toolId);
      if (s) {
        chip.hidden = false;
        chip.textContent = '↓ Use ' + label(s.v) + ' (from ' + s.n + ')';
      } else {
        chip.hidden = true;
      }
    }
    chip.addEventListener('click', function () {
      const s = FD.shared.suggest(quantity, read(), toolId);
      if (!s) return;
      write(FD.shared.round(quantity, s.v));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      refresh();
    });
    input.addEventListener('input', refresh);
    refresh();
    return refresh;
  };

  /* Shareable results (2026-09-26). A calculator reads its URL parameters
     from the list build_site puts in the page (#fd-tool-params, from
     site/data/tool_params.json), fills its inputs and calculates at once, and
     "Copy link to this result" writes the current inputs back into a link.
     A parameter that is missing, unknown, out of range or malformed is
     ignored without a word; the rest still apply. docs/tools-url-params.md
     lists them all.

     A page calls FD.share.init(hooks) at the end of its script, after its
     first compute and after any restore from this device. Hooks (all
     optional): set/get {name: fn} for a parameter the defaults cannot reach
     (the nav log's legs), after() once the values are in, silent (fill the
     fields without firing input events), hasResult(), scope (the selector a
     user edit must fall inside). A page that saves entries on this device
     asks FD.share.canSave() first: a page opened from a link does not save
     over the visitor's own entries until they change something.

     The first finished calculation of a page view, typed or arriving in the
     link, is counted once as the Meta Pixel event ToolCalculate, only
     through window.fdPixelEvent (assets/meta-pixel.js), which does nothing
     for a visitor the pixel is gated off for. */
  FD.share = (function () {
    let spec = null, parsed = null, hooks = {}, applying = false, edited = false, counted = false;

    function readSpec() {
      if (spec !== null) return spec;
      spec = false;
      const el = document.getElementById('fd-tool-params');
      if (el) { try { spec = JSON.parse(el.textContent); } catch (e) { spec = false; } }
      return spec;
    }
    function byId(id) { return id ? document.getElementById(id) : null; }
    function inRange(v, p) {
      if (typeof v !== 'number' || !isFinite(v)) return null;
      if (p.min !== undefined && v < p.min) return null;
      if (p.max !== undefined && v > p.max) return null;
      return v;
    }
    const NUM = /^[-+]?(\d+\.?\d*|\.\d+)$/;

    // One reader per type; null means "ignore this parameter".
    const PARSE = {
      number: function (s, p) { s = s.trim(); return NUM.test(s) ? inRange(parseFloat(s), p) : null; },
      temperature: function (s, p) {
        s = s.trim().toUpperCase();
        const m = s.match(/^M(\d+(?:\.\d+)?)$/);           // METAR style: M05 is -5
        if (m) return inRange(-parseFloat(m[1]), p);
        return NUM.test(s) ? inRange(parseFloat(s), p) : null;
      },
      altimeter: function (s, p) {
        s = s.trim().toUpperCase();
        let m = s.match(/^A?(\d{4})$/);                     // 2992 or A2992
        if (m) return inRange(parseInt(m[1], 10) / 100, p);
        m = s.match(/^Q(\d{3,4})$/);                        // hectopascals
        if (m) return inRange(Math.round(parseInt(m[1], 10) * 0.02953 * 100) / 100, p);
        return /^\d{2}(\.\d+)?$/.test(s) ? inRange(parseFloat(s), p) : null;
      },
      runway: function (s) {
        // One or two digits is a runway number (19, 09, 19L); three digits is
        // a heading (190, 015). Writing a heading as three digits is what
        // keeps 015 from reading as runway 15.
        const m = s.trim().toUpperCase().match(/^(\d{1,3})[LRC]?$/);
        if (!m) return null;
        const n = parseInt(m[1], 10);
        if (m[1].length === 3) return n >= 1 && n <= 360 ? n : null;
        return n >= 1 && n <= 36 ? n * 10 : null;
      },
      visibility: function (s, p) {
        s = s.trim().toUpperCase().replace(/\s*SM$/, '').trim();
        if (s === 'P6') return inRange(6, p);
        let m = s.match(/^(\d+)[\s_+-]+(\d+)\/(\d+)$/);    // 1 1/2
        if (m) return +m[3] ? inRange(+m[1] + m[2] / m[3], p) : null;
        m = s.match(/^(\d+)\/(\d+)$/);                      // 1/2
        if (m) return +m[2] ? inRange(m[1] / m[2], p) : null;
        return NUM.test(s) ? inRange(parseFloat(s), p) : null;
      },
      time: function (s) {
        const m = s.trim().match(/^(\d{1,2}):?(\d{2})(?::?(\d{2}))?$/);
        if (!m || +m[1] > 23 || +m[2] > 59 || (m[3] && +m[3] > 59)) return null;
        return m[1].padStart(2, '0') + ':' + m[2];
      },
      enum: function (s, p) {
        const k = s.trim().toLowerCase();
        const vals = p.values || [];
        for (let i = 0; i < vals.length; i++) if (String(vals[i]).toLowerCase() === k) return vals[i];
        const al = p.aliases || {};
        for (const a in al) if (a.toLowerCase() === k) return al[a];
        return null;
      },
      bool: function (s) {
        const k = s.trim().toLowerCase();
        if (/^(yes|y|true|1|on)$/.test(k)) return 'yes';
        if (/^(no|n|false|0|off)$/.test(k)) return 'no';
        return null;
      },
      text: function (s, p) {
        s = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, p.maxlen || 60);
        return s || null;
      },
      variation: function (s, p) {
        s = s.trim().toUpperCase().replace(/\s+/g, '');
        if (/^0+(\.0+)?$/.test(s)) return { mag: 0, dir: 'E' };
        let m = s.match(/^(\d{1,2}(?:\.\d+)?)([EW])$/), mag, dir;
        if (m) { mag = parseFloat(m[1]); dir = m[2]; }
        else if ((m = s.match(/^([EW])(\d{1,2}(?:\.\d+)?)$/))) { mag = parseFloat(m[2]); dir = m[1]; }
        else return null;
        return inRange(mag, p) === null ? null : { mag: mag, dir: dir };
      },
      flags: function (s, p) {
        const keys = Object.keys(p.flags || {});
        const got = s.split(/[,\s]+/).map(function (k) { return k.trim().toLowerCase(); })
          .filter(function (k) { return keys.indexOf(k) !== -1; });
        return got.length ? got : null;
      },
      list: function (rows) {
        const out = rows.map(function (r) { return r.trim(); }).filter(Boolean);
        return out.length ? out : null;
      }
    };

    function ours(q, s) {
      return s.params.some(function (p) { return q.has(p.name); });
    }

    function read() {
      if (parsed) return parsed;
      parsed = [];
      const s = readSpec();
      if (!s) return parsed;
      let q;
      try {
        q = new URLSearchParams(window.location.search);
        // A reload after scrub() below: the values live in the history entry.
        const st = window.history && window.history.state;
        if (!ours(q, s) && st && typeof st.fdShare === 'string') q = new URLSearchParams(st.fdShare);
      } catch (e) { return parsed; }
      s.params.forEach(function (p) {
        const many = p.repeat || p.type === 'list';
        const raw = many ? q.getAll(p.name) : q.get(p.name);
        if (raw === null || (many && !raw.length) || !PARSE[p.type]) return;
        let v = null;
        try { v = PARSE[p.type](raw, p); } catch (e) { v = null; }
        if (v !== null && v !== undefined) parsed.push({ p: p, v: v });
      });
      return parsed;
    }

    function fire(el, type) { el.dispatchEvent(new Event(type, { bubbles: true })); }

    function setDefault(p, v) {
      const quiet = !!hooks.silent;
      if (p.pills) {                                        // a solve-for pill
        const b = byId(p.pills[v]);
        if (!b) return false;
        b.click();
        return true;
      }
      if (p.type === 'variation') {                         // magnitude + E/W select
        const mag = byId(p.field), dir = byId(p.dir_field);
        if (!mag || !dir) return false;
        mag.value = v.mag;
        dir.value = v.dir;
        if (!quiet) { fire(mag, 'input'); fire(dir, 'change'); }
        return true;
      }
      if (p.type === 'flags') {
        let any = false;
        Object.keys(p.flags).forEach(function (k) {
          const box = byId(p.flags[k]);
          if (!box) return;
          box.checked = v.indexOf(k) !== -1;
          any = true;
          if (!quiet) fire(box, 'change');
        });
        return any;
      }
      const el = byId(p.field);
      if (!el) return false;
      if (el.tagName === 'SELECT') {
        const has = [].some.call(el.options, function (o) { return o.value === String(v); });
        if (!has) return false;
        el.value = String(v);
        if (!quiet) fire(el, 'change');
        return true;
      }
      if (el.type === 'checkbox') {
        el.checked = v === 'yes';
        if (!quiet) fire(el, 'change');
        return true;
      }
      el.value = typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v);
      if (!quiet) fire(el, 'input');
      return true;
    }

    function runwayOut(h) {
      if (!isFinite(h)) return null;
      h = Math.round(h) % 360;
      if (h <= 0) h += 360;
      return h % 10 === 0 ? String(h / 10).padStart(2, '0') : String(h).padStart(3, '0');
    }

    function getDefault(p) {
      if (p.pills) {
        for (const k in p.pills) {
          const b = byId(p.pills[k]);
          if (b && (b.classList.contains('active') || b.getAttribute('aria-pressed') === 'true')) return k;
        }
        return null;
      }
      if (p.type === 'variation') {
        const mag = byId(p.field), dir = byId(p.dir_field);
        if (!mag || !dir || String(mag.value).trim() === '' || !isFinite(+mag.value)) return null;
        const m = Math.abs(+mag.value);
        const out = m === 0 ? '0' : String(m) + dir.value;
        return PARSE.variation(out, p) ? out : null;
      }
      if (p.type === 'flags') {
        const on = Object.keys(p.flags).filter(function (k) { const b = byId(p.flags[k]); return b && b.checked; });
        return on.length ? on.join(',') : null;
      }
      const el = byId(p.field);
      if (!el) return null;
      if (el.closest && el.closest('.calc-field.is-output')) return null;   // a solved value is an output
      let val = el.type === 'checkbox' ? (el.checked ? 'yes' : 'no') : String(el.value || '').trim();
      if (val === '') return null;
      if (p.type === 'runway') val = runwayOut(+val);
      else if (p.type === 'time') val = val.replace(/^(\d{2}:\d{2}):00$/, '$1');
      else if (/^(number|temperature|altimeter|visibility)$/.test(p.type) && isFinite(+val)) val = String(+val);
      // Only what the page would accept back: a link must round-trip.
      return val !== null && PARSE[p.type] && PARSE[p.type](val, p) !== null ? val : null;
    }

    function enc(v) {
      return encodeURIComponent(v).replace(/%20/g, '+').replace(/%2C/gi, ',')
        .replace(/%3A/gi, ':').replace(/%2F/gi, '/');
    }

    function link() {
      const s = readSpec();
      const base = window.location.origin + window.location.pathname;
      if (!s) return base;
      const parts = [];
      s.params.forEach(function (p) {
        const g = hooks.get && hooks.get[p.name];
        let v = null;
        try { v = g ? g() : getDefault(p); } catch (e) { v = null; }
        (Array.isArray(v) ? v : [v]).forEach(function (x) {
          if (x !== null && x !== undefined && String(x) !== '') parts.push(p.name + '=' + enc(String(x)));
        });
      });
      return parts.length ? base + '?' + parts.join('&') : base;
    }

    function hasResult() {
      if (hooks.hasResult) { try { return !!hooks.hasResult(); } catch (e) { return false; } }
      return [].some.call(document.querySelectorAll('.result-value'), function (el) {
        return /[0-9A-Za-z]/.test(el.textContent);
      });
    }

    function count() {
      const s = readSpec();
      if (counted || !s) return;
      counted = true;                       // once per page view, sent or not
      function send() {
        if (typeof window.fdPixelEvent === 'function') window.fdPixelEvent('ToolCalculate', { tool: s.event });
      }
      // meta-pixel.js is deferred, so while the page is still parsing (a link
      // applied at load) the helper arrives just before DOMContentLoaded.
      if (typeof window.fdPixelEvent === 'function') send();
      else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', send);
    }

    // Take the calculator's values out of the address bar once they are in
    // the fields. The privacy page promises the Meta Pixel never receives
    // anything typed into a calculator, and the pixel reports the page's
    // address, so the values must not be in it when the pixel starts (after
    // the page has loaded; this runs while it parses). They stay in the
    // history entry, so a reload still shows them, and "Copy link to this
    // result" still writes them. Other parameters (utm_*, fbclid) stay.
    function scrub() {
      const s = readSpec();
      if (!s || !window.history || !window.history.replaceState) return;
      try {
        const q = new URLSearchParams(window.location.search);
        if (!ours(q, s)) return;
        const search = window.location.search;
        s.params.forEach(function (p) { q.delete(p.name); });
        const rest = q.toString();
        const state = Object.assign({}, window.history.state || {}, { fdShare: search });
        window.history.replaceState(state, '', window.location.pathname + (rest ? '?' + rest : '') + window.location.hash);
      } catch (e) { /* a sandboxed frame: leave the address alone */ }
    }
    // Once the visitor changes something the page is theirs: a reload shows
    // their own entries again, not the link's.
    function forget() {
      try {
        const st = window.history.state;
        if (st && st.fdShare !== undefined) {
          const copy = Object.assign({}, st);
          delete copy.fdShare;
          window.history.replaceState(copy, '', window.location.href);
        }
      } catch (e) { /* nothing stored */ }
    }

    function inScope(t) {
      if (!t || !t.closest || t.closest('.tool-share, .tool-follow')) return false;
      return !!t.closest(hooks.scope || '.calc-card');
    }
    function isEdit(e) {
      return !applying && inScope(e.target) && (e.type !== 'click' || !!e.target.closest('button'));
    }
    // Capture phase: runs before the page's own handler, so the save that
    // handler makes already knows the visitor has changed something.
    function markEdit(e) {
      if (!isEdit(e)) return;
      if (!edited) forget();
      edited = true;
    }
    function onEdit(e) { if (isEdit(e) && hasResult()) count(); }

    function wireCopy() {
      const btn = document.querySelector('[data-share-copy]');
      if (!btn) return;
      const status = document.querySelector('[data-share-status]');
      const field = document.querySelector('[data-share-url]');
      let timer = null;
      function say(msg, ok) {
        if (!status) return;
        status.textContent = msg;
        status.classList.toggle('ok', !!ok);
        clearTimeout(timer);
        if (ok) timer = setTimeout(function () { status.textContent = ''; status.classList.remove('ok'); }, 4000);
      }
      btn.addEventListener('click', function () {
        const url = link();
        if (field) field.value = url;
        function copied() { if (field) field.hidden = true; say('Link copied', true); }
        function fallback() {
          // The clipboard API refused (an old browser, an embedded web view, a
          // page not served over HTTPS): show the link selected, try the old
          // copy command, and say which of the two happened.
          if (field) {
            field.hidden = false;
            field.focus();
            field.select();
            try { field.setSelectionRange(0, url.length); } catch (e) { /* not selectable */ }
          }
          let ok = false;
          try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
          if (ok) say('Link copied', true);
          else say('Copying was blocked. The link below is selected, ready to copy.', false);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(copied, fallback);
        } else {
          fallback();
        }
      });
    }

    function init(h) {
      hooks = h || {};
      if (!readSpec()) return;
      applying = true;
      let applied = 0;
      read().forEach(function (it) {
        const set = hooks.set && hooks.set[it.p.name];
        let ok = false;
        try { ok = set ? set(it.v) !== false : setDefault(it.p, it.v); } catch (e) { ok = false; }
        if (ok) applied++;
      });
      if (applied && hooks.after) { try { hooks.after(); } catch (e) { /* page code */ } }
      applying = false;
      scrub();
      ['input', 'change', 'click'].forEach(function (type) {
        document.addEventListener(type, markEdit, true);
        document.addEventListener(type, onEdit);
      });
      wireCopy();
      if (applied && hasResult()) count();
    }

    return {
      init: init,
      link: link,
      read: read,
      present: function () { return read().length > 0; },
      canSave: function () { return !read().length || edited; },
      count: count
    };
  })();

  /* FAQ accordion (shared) */
  document.querySelectorAll('.faq-question').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const item = btn.closest('.faq-item');
      const isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item').forEach(function (el) {
        el.classList.remove('open');
        el.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
      });
      if (!isOpen) {
        item.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });
})();
