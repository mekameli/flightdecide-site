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
      st.querySelectorAll('button').forEach(function (btn) {
        const dir = btn.classList.contains('step-up') ? 1 : -1;
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
        btn.addEventListener('click', function (e) { e.preventDefault(); }); // pointerdown already bumped
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
     fresher value from another tool exists. Tapping it fills the field. */
  FD.attachPrefill = function (input, quantity, toolId, toolName) {
    if (!input || !FD.shared.meta[quantity]) return;
    const host = input.closest('.calc-field') || input.parentElement;
    if (!host) return;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'prefill-chip';
    chip.hidden = true;
    host.appendChild(chip);
    function refresh() {
      const s = FD.shared.suggest(quantity, parseFloat(input.value), toolId);
      if (s) {
        chip.hidden = false;
        chip.textContent = '↓ Use ' + FD.shared.fmt(quantity, s.v) + ' (from ' + s.n + ')';
      } else {
        chip.hidden = true;
      }
    }
    chip.addEventListener('click', function () {
      const s = FD.shared.suggest(quantity, parseFloat(input.value), toolId);
      if (!s) return;
      input.value = FD.shared.round(quantity, s.v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      refresh();
    });
    input.addEventListener('input', refresh);
    refresh();
  };

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
