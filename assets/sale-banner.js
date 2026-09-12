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

    var style = document.createElement('style');
    style.textContent = [
      '.fd-sale-bar{position:fixed;left:0;right:0;bottom:0;z-index:9000;',
      'display:flex;align-items:center;justify-content:center;gap:10px;',
      'flex-wrap:wrap;padding:10px 44px 10px 16px;',
      'background:rgba(15,23,42,0.97);border-top:1px solid rgba(34,197,94,0.45);',
      '-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);',
      "font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',system-ui,sans-serif;",
      'font-size:14px;line-height:1.45;color:#F0F0F5;}',
      '.fd-sale-bar strong{color:#22C55E;font-weight:700;}',
      '.fd-sale-bar a{color:#0F172A;background:#22C55E;text-decoration:none;',
      'font-weight:700;font-size:13px;padding:6px 14px;border-radius:999px;white-space:nowrap;}',
      '.fd-sale-bar a:hover{background:#4ADE80;}',
      '.fd-sale-close{position:absolute;right:8px;top:50%;transform:translateY(-50%);',
      'background:transparent;border:0;color:#94A3B8;font-size:20px;line-height:1;',
      'cursor:pointer;padding:6px 10px;border-radius:8px;font-family:inherit;}',
      '.fd-sale-close:hover{color:#F0F0F5;}',
      '@media (max-width:520px){.fd-sale-bar{font-size:13px;padding:9px 40px 9px 12px;}}'
    ].join('');
    document.head.appendChild(style);

    var bar = document.createElement('div');
    bar.className = 'fd-sale-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'FlightDecide sale');

    var text = document.createElement('span');
    var lead = document.createElement('strong');
    lead.textContent = 'Sale: Pilot is 50% off';
    text.appendChild(lead);
    text.appendChild(document.createTextNode(' through November 30, 2026.'));

    var link = document.createElement('a');
    link.href = TARGET;
    link.textContent = 'Get the code';

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'fd-sale-close';
    close.setAttribute('aria-label', 'Dismiss the sale notice');
    close.textContent = '×';
    close.addEventListener('click', function () {
      bar.remove();
      document.body.style.paddingBottom = priorPadding;
      try { window.localStorage.setItem(STORAGE_KEY, '1'); } catch (err) { /* fine */ }
    });

    bar.appendChild(text);
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
