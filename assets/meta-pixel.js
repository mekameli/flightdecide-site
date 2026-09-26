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
 * PIXEL_ID is the "FlightDecide website" dataset in Meta Events Manager
 * (Kamitec portfolio, created 2026-09-22). Empty it and the file does nothing.
 */
(function () {
  "use strict";
  var PIXEL_ID = "1058922163570601";
  if (!/^[0-9]{10,20}$/.test(PIXEL_ID)) { return; }

  var nav = window.navigator || {};
  if (nav.globalPrivacyControl === true) { return; }
  if (nav.doNotTrack === "1" || window.doNotTrack === "1" || nav.msDoNotTrack === "1") { return; }
  var zone = "";
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { zone = ""; }
  if (/^Europe\//.test(zone)) { return; }
  if (String(nav.language || "").toLowerCase() === "fr-ca") { return; }

  /* Meta's standard loader, verbatim. */
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
  document,'script','https://connect.facebook.net/en_US/fbevents.js');

  window.fbq('dataProcessingOptions', ['LDU'], 0, 0);
  window.fbq('init', PIXEL_ID);
  window.fbq('track', 'PageView');
})();
