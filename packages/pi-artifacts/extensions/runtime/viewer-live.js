/**
 * pi-artifacts live reload (Phase D).
 *
 * Served from /runtime/pi/viewer-live.js so it runs under the strict CSP
 * (`script-src 'self'` blocks inline <script> but allows same-origin files).
 * Subscribes to the server's SSE stream and reloads the page on the relevant
 * `update` event.
 *
 * Two consumers share this one script:
 *   - The gallery (/viewer) includes it with no id and reloads on every update
 *     (any render/delete, or a session change that re-scopes the list).
 *   - An artifact page (/artifacts/<id>/) includes it with
 *     data-artifact-id="<id>" and reloads only when THAT artifact is
 *     re-rendered, so editing one artifact does not reload unrelated tabs.
 *
 * The id is read from the script tag's data attribute (currentScript is null
 * for deferred scripts, so we query by attribute instead).
 */
(() => {
  var tag = document.querySelector("script[data-artifact-id]");
  var myId = tag ? tag.getAttribute("data-artifact-id") : null;

  var es = new EventSource("/events");
  es.addEventListener("update", (event) => {
    var changedId = null;
    try {
      changedId = JSON.parse(event.data || "{}").id || null;
    } catch (error) {
      changedId = null;
    }

    if (myId === null) {
      // Gallery: any change is relevant.
      location.reload();
      return;
    }
    // Artifact page: reload only when this artifact changed.
    if (changedId === myId) {
      location.reload();
    }
  });
})();
