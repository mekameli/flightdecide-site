/* Fall 2026 sale bar, shared by every entry page except the homepage, which
   carries its own hero and pricing-card treatment.

   Fixed to the BOTTOM on purpose. These 70-odd pages were built at different
   times with different headers, and a top strip would have to be reconciled
   with each one; the bottom edge is free everywhere, so one rule fits all.

   It expires itself. FD-595 recorded the failure mode: "Nothing on the website
   removes the offer copy by itself", leaving a human teardown as the only
   thing standing between a finished campaign and stale copy. Here the window
   is a constant, and after it passes the bar stops rendering on every page at
   once. A missed teardown then costs a dead script tag, not a false price.

   The codes it points at are FLY50YEAR and FLY50MONTH, both minted against
   the ASC offers FD50PY and FD50PM and both expiring the same day as the
   window below. Removal steps live in
   backlog/evidence/FD-595/slice2-website-copy.md section 6. */
(function () {
  'use strict';

  var STORAGE_KEY = 'fd-sale-fall-2026-dismissed';
  var ENDS_AT = Date.UTC(2026, 10, 30, 23, 59, 59); // 2026-11-30, the last day of the window
  var TARGET = '/#pricing';

  if (Date.now() > ENDS_AT) return;

  // A viewer who dismissed it stays dismissed. Storage can throw outright in
  // private modes, and a sale bar is not worth a broken page, so any failure
  // here just means the bar shows.
  try {
    if (window.localStorage.getItem(STORAGE_KEY)) return;
  } catch (err) { /* no storage: show the bar */ }

  // Never stack the bar on the page it links into.
  if (location.pathname === '/' || location.pathname === '/index.html') return;

  function build() {
    // Captured before the bar widens it, so dismissing restores what the
    // page had rather than clearing a value the page set itself.
    var priorPadding = document.body.style.paddingBottom || '';

    // Same design language as the offer box on the pricing card: the cut is
    // the loudest thing, its terms sit quietly beside it, and exactly one
    // solid green element carries the action. The close button shares the
    // CTA's height and sits in normal flex flow rather than being absolutely
    // positioned, which is what made it drift out of line once the bar
    // wrapped to two lines on a phone.
    var style = document.createElement('style');
    style.textContent = [
      '.fd-sale-bar{position:fixed;left:0;right:0;bottom:0;z-index:9000;',
      'display:flex;align-items:center;justify-content:center;gap:14px;',
      'flex-wrap:wrap;padding:9px 14px;',
      'background:rgba(15,23,42,0.97);border-top:1px solid rgba(34,197,94,0.45);',
      '-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);',
      "font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',system-ui,sans-serif;",
      'line-height:1.4;color:#F0F0F5;}',
      '.fd-sale-msg{display:flex;align-items:baseline;gap:9px;',
      'flex-wrap:wrap;justify-content:center;min-width:0;}',
      '.fd-sale-pct{font-size:17px;font-weight:800;letter-spacing:-0.3px;',
      'color:#22C55E;line-height:1;}',
      '.fd-sale-sub{font-size:13px;color:#94A3B8;}',
      '.fd-sale-cta,.fd-sale-close{height:36px;box-sizing:border-box;',
      'display:inline-flex;align-items:center;justify-content:center;',
      'flex:0 0 auto;font-family:inherit;}',
      '.fd-sale-cta{padding:0 16px;border-radius:999px;background:#22C55E;',
      'color:#06240F;font-weight:700;font-size:13px;text-decoration:none;',
      'white-space:nowrap;transition:background 0.2s;}',
      '.fd-sale-cta:hover{background:#4ADE80;}',
      '.fd-sale-close{width:36px;padding:0;background:transparent;border:0;',
      'color:#94A3B8;font-size:20px;line-height:1;cursor:pointer;',
      'border-radius:9px;transition:color 0.2s,background 0.2s;}',
      '.fd-sale-close:hover{color:#F0F0F5;background:rgba(255,255,255,0.07);}',
      '@media (max-width:560px){.fd-sale-bar{gap:10px;padding:8px 10px;}',
      '.fd-sale-pct{font-size:15px;}.fd-sale-sub{font-size:12px;}}'
    ].join('');
    document.head.appendChild(style);

    var bar = document.createElement('div');
    bar.className = 'fd-sale-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'FlightDecide sale');

    var msg = document.createElement('span');
    msg.className = 'fd-sale-msg';

    var pct = document.createElement('strong');
    pct.className = 'fd-sale-pct';
    pct.textContent = '50% OFF';

    var sub = document.createElement('span');
    sub.className = 'fd-sale-sub';
    sub.textContent = 'Pilot, ends November 30, 2026';

    msg.appendChild(pct);
    msg.appendChild(sub);

    var link = document.createElement('a');
    link.className = 'fd-sale-cta';
    link.href = TARGET;
    link.textContent = 'Get the code';

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'fd-sale-close';
    close.setAttribute('aria-label', 'Dismiss the sale notice');
    close.textContent = '\u00d7';
    close.addEventListener('click', function () {
      bar.remove();
      document.body.style.paddingBottom = priorPadding;
      try { window.localStorage.setItem(STORAGE_KEY, '1'); } catch (err) { /* fine */ }
    });

    bar.appendChild(msg);
    bar.appendChild(link);
    bar.appendChild(close);
    document.body.appendChild(bar);

    // Keep the footer reachable above the bar rather than pinned under it.
    document.body.style.paddingBottom = (bar.offsetHeight + 16) + 'px';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
