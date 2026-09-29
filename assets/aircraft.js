/* Aircraft page behaviour.
 *
 * Deliberately small and additive: the pages are fully readable with this file
 * absent (every weight panel is plain HTML, the first one visible). Anything
 * richer we add later - charts, a conditions picker, unit toggles - belongs
 * here and in aircraft.css, so it ships to all 40+ pages without regenerating
 * a single one. Each page also publishes its numbers at ./data.json.
 */
(function () {
  "use strict";

  function selectWeight(group) {
    var id = group.getAttribute("data-for");
    var scope = document.querySelector('[data-perf="' + id + '"]');
    if (!scope) return;
    group.addEventListener("click", function (ev) {
      var btn = ev.target.closest("button[data-weight]");
      if (!btn) return;
      var want = btn.getAttribute("data-weight");
      group.querySelectorAll("button[data-weight]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b === btn));
      });
      scope.querySelectorAll(".perf-panel").forEach(function (panel) {
        panel.hidden = panel.getAttribute("data-weight") !== want;
      });
    });
  }

  document.querySelectorAll(".perf-tabs[data-for]").forEach(selectWeight);
})();
