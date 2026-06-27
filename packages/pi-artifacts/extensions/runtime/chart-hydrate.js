/**
 * pi-artifacts Chart.js hydration (Phase C, Pass 2).
 *
 * CSP-clean charting: authored html never contains executable JS. Instead the
 * author writes a <canvas data-chart> paired with a sibling
 * <script type="application/json"> holding a Chart.js config. JSON is data, not
 * code, so it is allowed under `script-src 'self'`. This file is the only chart
 * script, served from /runtime/pi/chart-hydrate.js, and it reads those specs
 * and renders them with the global `Chart` from /runtime/chartjs.
 *
 * Authoring shape:
 *   <figure>
 *     <canvas data-chart></canvas>
 *     <script type="application/json" class="pi-chart-spec">
 *       { "type": "bar", "data": { ... }, "options": { ... } }
 *     </script>
 *   </figure>
 *
 * The spec <script> may be the canvas's next sibling, or any descendant
 * <script class="pi-chart-spec"> within the same parent element.
 */
(() => {
  function findSpec(canvas) {
    var next = canvas.nextElementSibling;
    if (next && isSpecScript(next)) {
      return next;
    }
    var parent = canvas.parentElement;
    if (parent) {
      var scoped = parent.querySelector("script.pi-chart-spec");
      if (scoped) {
        return scoped;
      }
    }
    return null;
  }

  function isSpecScript(el) {
    return (
      el.tagName === "SCRIPT" &&
      (el.classList.contains("pi-chart-spec") ||
        el.getAttribute("type") === "application/json")
    );
  }

  function renderError(canvas, message) {
    var note = document.createElement("p");
    note.setAttribute("role", "alert");
    note.style.color = "#dc2626";
    note.textContent = "Chart error: " + message;
    if (canvas.parentElement) {
      canvas.parentElement.insertBefore(note, canvas.nextSibling);
    }
  }

  function hydrate() {
    if (typeof window.Chart === "undefined") {
      return;
    }
    var canvases = document.querySelectorAll("canvas[data-chart]");
    for (var i = 0; i < canvases.length; i += 1) {
      var canvas = canvases[i];
      var spec = findSpec(canvas);
      if (!spec) {
        renderError(canvas, 'no <script class="pi-chart-spec"> config found.');
        continue;
      }
      var config;
      try {
        config = JSON.parse(spec.textContent || "");
      } catch (error) {
        renderError(canvas, "invalid JSON config (" + error.message + ").");
        continue;
      }
      try {
        new window.Chart(canvas, config);
      } catch (error) {
        renderError(canvas, error.message);
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hydrate);
  } else {
    hydrate();
  }
})();
