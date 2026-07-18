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
