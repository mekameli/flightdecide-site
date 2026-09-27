/* Meta Pixel for flightdecide.com. Website only, never the app.
 *
 * One external file on purpose: 101 pages and three page generators carry
 * the tag (scripts/add_meta_pixel.py puts it there), so the pixel id and
 * the rules below change here and nothing has to be regenerated.
 *
 * Who it does NOT load for, decided before Meta's loader is even fetched:
 *   - browsers sending Global Privacy Control or Do Not Track;
 *   - browsers whose time zone is in Europe (GDPR and UK GDPR want opt-in
 *     for advertising cookies, and this site has no consent banner);
 *   - browsers set to French (Canada): Quebec's Law 25 wants opt-in for
 *     technologies that profile, and a time zone cannot tell Quebec from
 *     Ontario.
 * Everyone else gets one PageView with Meta's Limited Data Use flag set,
 * which makes Meta apply its California handling by geolocation.
 * Disclosed at /privacy.html, section 4.
 *
 * It starts after the page has loaded, not while it loads (2026-09-25).
 * Meta's two files are about 190 KB of script, more than the page itself
 * loads, and running them during the first paint held the page's main
 * picture back: Lighthouse measured up to 250 ms of main-thread blocking
 * and a 4.4 s largest paint with the pixel, against none and 1.3 to 2.5 s
 * with it blocked. The PageView is the same one, sent a moment later.
 *
 * PIXEL_ID is the "FlightDecide website" dataset in Meta Events Manager
 * (Kamitec portfolio, created 2026-09-22). Empty it and the file does nothing.
 *
 * Custom events from the site's own pages go through window.fdPixelEvent
 * (2026-09-26; the /tools/ calculators send ToolCalculate {tool} through
 * assets/tools.js). Nothing else on the site may call fbq directly. The
 * helper always exists, so a caller never has to test for it, and it:
 *   - does nothing, and returns false, for every visitor the rules above
 *     keep the pixel from (and when PIXEL_ID is empty);
 *   - holds an event made before the pixel has started (a calculation that
 *     arrives in a link runs while the page loads) and sends it right after
 *     the PageView, or never, if the pixel never starts;
 *   - sends one event per name and tool per page view; a repeat returns
 *     false.
 * scripts/check_meta_pixel.mjs holds all of this to account.
 */
(function () {
  "use strict";
  var PIXEL_ID = "1058922163570601";

  var state = "off";            // "off": gated or no id; "waiting": allowed, not started; "on"
  var held = [];
  var sent = {};
  window.fdPixelEvent = function (name, params) {
    if (state === "off" || typeof name !== "string" || !name) { return false; }
    var p = params || {};
    var key = name + "|" + String(p.tool || "");
    if (sent[key]) { return false; }
    sent[key] = true;
    if (state === "on") { window.fbq("trackCustom", name, p); }
    else { held.push([name, p]); }
    return true;
  };

  if (!/^[0-9]{10,20}$/.test(PIXEL_ID)) { return; }

  var nav = window.navigator || {};
  if (nav.globalPrivacyControl === true) { return; }
  if (nav.doNotTrack === "1" || window.doNotTrack === "1" || nav.msDoNotTrack === "1") { return; }
  var zone = "";
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { zone = ""; }
  if (/^Europe\//.test(zone)) { return; }
  if (String(nav.language || "").toLowerCase() === "fr-ca") { return; }
  state = "waiting";

  function start() {
    /* Meta's standard loader, verbatim. */
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js');

    window.fbq('dataProcessingOptions', ['LDU'], 0, 0);
    window.fbq('init', PIXEL_ID);
    window.fbq('track', 'PageView');
    state = "on";
    for (var i = 0; i < held.length; i++) { window.fbq("trackCustom", held[i][0], held[i][1]); }
    held = [];
  }
  function soon() {
    if (window.requestIdleCallback) { window.requestIdleCallback(start, { timeout: 2000 }); }
    else { window.setTimeout(start, 200); }
  }
  if (document.readyState === "complete") { soon(); }
  else { window.addEventListener("load", soon); }
})();
