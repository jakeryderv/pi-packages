/**
 * Declarative pi-artifacts components and file-backed data feeds.
 *
 * Artifacts author markup and JSON only. This package-owned runtime provides
 * the executable behavior under the viewer's strict same-origin CSP.
 */
(() => {
  const feeds = new Map();
  const listeners = new Map();

  function readPath(value, path) {
    if (!path) return value;
    return path.split(".").reduce((current, key) => {
      if (
        current === null ||
        current === undefined ||
        !Object.hasOwn(Object(current), key)
      ) {
        return undefined;
      }
      return current[key];
    }, value);
  }

  function artifactAssetUrl(src) {
    if (
      !/^assets\/[A-Za-z0-9][A-Za-z0-9._/-]*\.json$/.test(src) ||
      src.split("/").some((part) => part === ".." || part === ".")
    ) {
      throw new Error(
        "feed src must be a JSON path beneath assets/ using URL-safe filename characters.",
      );
    }

    let pageUrl;
    let assetsRoot;
    let sourceUrl;
    try {
      pageUrl = new URL(location.href);
      assetsRoot = new URL("assets/", pageUrl);
      sourceUrl = new URL(src, pageUrl);
    } catch {
      throw new Error("feed src could not be resolved as an artifact URL.");
    }
    if (
      sourceUrl.origin !== assetsRoot.origin ||
      !sourceUrl.pathname.startsWith(assetsRoot.pathname)
    ) {
      throw new Error("feed src escapes this artifact's assets directory.");
    }
    return sourceUrl.href;
  }

  function displayText(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function publish(name, value, error) {
    const state = { value, error };
    feeds.set(name, state);
    for (const listener of listeners.get(name) || []) listener(state);
  }

  function subscribe(name, listener) {
    let set = listeners.get(name);
    if (!set) {
      set = new Set();
      listeners.set(name, set);
    }
    set.add(listener);
    if (feeds.has(name)) listener(feeds.get(name));
    return () => {
      set.delete(listener);
      if (set.size === 0) listeners.delete(name);
    };
  }

  window.PiArtifactData = Object.freeze({
    publish(name, value) {
      if (typeof name === "string" && name) publish(name, value);
    },
    subscribe,
    get(name) {
      return feeds.get(name)?.value;
    },
  });

  class PiDataSource extends HTMLElement {
    connectedCallback() {
      const name = this.getAttribute("name");
      const src = this.getAttribute("src");
      if (!name || !src) return;

      this.abortController?.abort();
      this.abortController = new AbortController();
      let sourceUrl;
      try {
        sourceUrl = artifactAssetUrl(src);
      } catch (error) {
        publish(
          name,
          undefined,
          error instanceof Error ? error.message : String(error),
        );
        return;
      }

      fetch(sourceUrl, {
        credentials: "same-origin",
        signal: this.abortController.signal,
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`request failed (${response.status})`);
          }
          return response.json();
        })
        .then((value) => publish(name, value))
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          publish(
            name,
            undefined,
            error instanceof Error ? error.message : String(error),
          );
        });
    }

    disconnectedCallback() {
      this.abortController?.abort();
      this.abortController = undefined;
    }
  }

  class FeedElement extends HTMLElement {
    connectedCallback() {
      this.bindFeed();
    }

    disconnectedCallback() {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
    }

    bindFeed() {
      this.unsubscribe?.();
      const feed = this.getAttribute("data-feed");
      if (!feed) {
        this.renderValue(undefined);
        return;
      }
      this.unsubscribe = subscribe(feed, (state) => {
        if (state.error) {
          this.renderError(state.error);
          return;
        }
        this.renderValue(readPath(state.value, this.getAttribute("field")));
      });
    }

    renderError(message) {
      this.replaceChildren();
      const note = document.createElement("p");
      note.className = "pi-component-error";
      note.setAttribute("role", "alert");
      note.textContent = `Data error: ${message}`;
      this.append(note);
    }
  }

  class PiGrid extends HTMLElement {}
  class PiCard extends HTMLElement {}

  class PiMetric extends FeedElement {
    renderValue(value) {
      const label = this.getAttribute("label") || "Metric";
      const resolved = value ?? this.getAttribute("value") ?? "—";
      const trendField = this.getAttribute("trend-field");
      const feedState = this.getAttribute("data-feed")
        ? feeds.get(this.getAttribute("data-feed"))?.value
        : undefined;
      const trend = trendField
        ? readPath(feedState, trendField)
        : this.getAttribute("trend");

      this.replaceChildren();
      const labelElement = document.createElement("span");
      labelElement.className = "pi-metric-label";
      labelElement.textContent = label;
      const valueElement = document.createElement("strong");
      valueElement.className = "pi-metric-value";
      valueElement.textContent = String(resolved);
      this.append(labelElement, valueElement);
      if (trend !== null && trend !== undefined) {
        const trendElement = document.createElement("small");
        trendElement.className = "pi-metric-trend";
        trendElement.textContent = String(trend);
        this.append(trendElement);
      }
    }
  }

  class PiTable extends FeedElement {
    renderValue(value) {
      if (value === undefined && !this.getAttribute("data-feed")) return;
      if (!Array.isArray(value)) {
        this.renderError("table feed must resolve to an array.");
        return;
      }

      const declared = (this.getAttribute("columns") || "")
        .split(",")
        .map((column) => column.trim())
        .filter(Boolean);
      if (
        value.some(
          (row) =>
            row === null || typeof row !== "object" || Array.isArray(row),
        )
      ) {
        this.renderError("table rows must be JSON objects.");
        return;
      }

      const columns =
        declared.length > 0
          ? declared
          : [...new Set(value.flatMap((row) => Object.keys(row)))];

      const table = document.createElement("table");
      if (columns.length > 0) {
        const head = document.createElement("thead");
        const row = document.createElement("tr");
        for (const column of columns) {
          const cell = document.createElement("th");
          cell.scope = "col";
          cell.textContent = column;
          row.append(cell);
        }
        head.append(row);
        table.append(head);
      }

      const body = document.createElement("tbody");
      for (const item of value) {
        const row = document.createElement("tr");
        for (const column of columns) {
          const cell = document.createElement("td");
          const cellValue = Object.hasOwn(item, column)
            ? item[column]
            : undefined;
          cell.textContent = displayText(cellValue);
          row.append(cell);
        }
        body.append(row);
      }
      table.append(body);
      this.replaceChildren(table);
    }
  }

  class PiChart extends FeedElement {
    connectedCallback() {
      this.inlineConfig = this.readInlineConfig();
      super.connectedCallback();
    }

    disconnectedCallback() {
      this.chart?.destroy();
      this.chart = undefined;
      super.disconnectedCallback();
    }

    readInlineConfig() {
      const spec = this.querySelector(
        'script.pi-chart-spec, script[type="application/json"]',
      );
      if (!spec) return undefined;
      try {
        return JSON.parse(spec.textContent || "");
      } catch (error) {
        this.renderError(
          `invalid chart JSON (${error instanceof Error ? error.message : String(error)}).`,
        );
        return undefined;
      }
    }

    renderValue(value) {
      const config = value ?? this.inlineConfig;
      if (!config) {
        if (this.getAttribute("data-feed")) return;
        this.renderError("chart requires a data feed or JSON chart spec.");
        return;
      }
      if (window.Chart === undefined) {
        this.renderError("Chart.js runtime is unavailable.");
        return;
      }

      this.chart?.destroy();
      this.replaceChildren();
      const canvas = document.createElement("canvas");
      this.append(canvas);
      try {
        this.chart = new window.Chart(canvas, config);
      } catch (error) {
        this.renderError(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  const components = [
    ["pi-data-source", PiDataSource],
    ["pi-grid", PiGrid],
    ["pi-card", PiCard],
    ["pi-metric", PiMetric],
    ["pi-chart", PiChart],
    ["pi-table", PiTable],
  ];
  for (const [name, componentClass] of components) {
    if (!customElements.get(name)) customElements.define(name, componentClass);
  }
})();
