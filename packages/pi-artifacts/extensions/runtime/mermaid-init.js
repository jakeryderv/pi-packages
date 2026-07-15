/**
 * pi-artifacts Mermaid hydration.
 *
 * CSP-clean diagrams: authored content carries only declarative
 * <pre class="mermaid"> blocks (markdown ```mermaid fences render to the same
 * shape). This file is the only mermaid script, served from
 * /runtime/pi/mermaid-init.js alongside the mermaid bundle from
 * /runtime/mermaid, both under `script-src 'self'`.
 *
 * Parse/render errors are surfaced by mermaid's own in-place error rendering,
 * so a broken diagram shows a visible error where the diagram would be.
 */
(() => {
  function render() {
    if (typeof window.mermaid === "undefined") {
      return;
    }
    var dark =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: dark ? "dark" : "default",
    });
    window.mermaid.run({ querySelector: "pre.mermaid" }).catch(function () {
      // mermaid.run rejects after rendering the error in place; swallowing it
      // only avoids an unhandled-rejection console entry.
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();
