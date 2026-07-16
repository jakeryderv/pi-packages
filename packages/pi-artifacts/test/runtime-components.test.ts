import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

class FakeElement {
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  className = "";
  scope = "";
  textContent = "";

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children = children;
  }

  querySelector(): FakeElement | null {
    return null;
  }
}

interface RuntimeHarness {
  registry: Map<string, typeof FakeElement>;
  fetchCalls: string[];
  data: {
    publish: (name: string, value: unknown) => void;
  };
  chartInstances: Array<{ destroyed: boolean }>;
}

async function createHarness(): Promise<RuntimeHarness> {
  const source = await readFile(
    new URL("../extensions/runtime/artifact-components.js", import.meta.url),
    "utf8",
  );
  const registry = new Map<string, typeof FakeElement>();
  const fetchCalls: string[] = [];
  const chartInstances: Array<{ destroyed: boolean }> = [];
  const window = {
    PiArtifactData: undefined as
      | { publish: (name: string, value: unknown) => void }
      | undefined,
    Chart: class {
      destroyed = false;

      constructor(_canvas: unknown, _config: unknown) {
        chartInstances.push(this);
      }

      destroy() {
        this.destroyed = true;
      }
    },
  };

  const context = vm.createContext({
    AbortController,
    DOMException,
    HTMLElement: FakeElement,
    URL,
    customElements: {
      define(name: string, componentClass: typeof FakeElement) {
        registry.set(name, componentClass);
      },
      get(name: string) {
        return registry.get(name);
      },
    },
    document: {
      createElement() {
        return new FakeElement();
      },
    },
    fetch: async (url: string) => {
      fetchCalls.push(url);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            total: "<b>42</b>",
            rows: [{ name: "<img src=x>", amount: 42 }],
            chart: { type: "bar", data: { labels: [], datasets: [] } },
          };
        },
      };
    },
    location: {
      href: "http://127.0.0.1:43123/token/artifacts/demo/",
    },
    window,
  });
  vm.runInContext(source, context);

  assert.ok(window.PiArtifactData);
  return {
    registry,
    fetchCalls,
    data: window.PiArtifactData,
    chartInstances,
  };
}

function component(
  harness: RuntimeHarness,
  name: string,
  attributes: Record<string, string> = {},
): FakeElement & {
  connectedCallback?: () => void;
  disconnectedCallback?: () => void;
} {
  const Component = harness.registry.get(name);
  assert.ok(Component, `missing component ${name}`);
  const element = new Component();
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  return element;
}

async function nextTask(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("component runtime registers the declarative component set", async () => {
  const harness = await createHarness();
  assert.deepEqual(
    [...harness.registry.keys()],
    [
      "pi-data-source",
      "pi-grid",
      "pi-card",
      "pi-metric",
      "pi-chart",
      "pi-table",
    ],
  );
});

test("file feeds stay under artifact assets and render values as text", async () => {
  const harness = await createHarness();
  const metric = component(harness, "pi-metric", {
    label: "Revenue",
    "data-feed": "sales",
    field: "total",
  });
  metric.connectedCallback?.();

  const source = component(harness, "pi-data-source", {
    name: "sales",
    src: "assets/sales.json",
  });
  source.connectedCallback?.();
  await nextTask();

  assert.deepEqual(harness.fetchCalls, [
    "http://127.0.0.1:43123/token/artifacts/demo/assets/sales.json",
  ]);
  assert.equal(metric.children[0]?.textContent, "Revenue");
  assert.equal(metric.children[1]?.textContent, "<b>42</b>");

  const blocked = component(harness, "pi-data-source", {
    name: "secret",
    src: "../other/secret.json",
  });
  blocked.connectedCallback?.();
  const encoded = component(harness, "pi-data-source", {
    name: "encoded",
    src: "assets/%2e%2e%2fmanifest.json",
  });
  encoded.connectedCallback?.();
  assert.equal(harness.fetchCalls.length, 1);

  const inlineMetric = component(harness, "pi-metric", {
    label: "Inline",
    "data-feed": "inline",
    field: "total",
  });
  inlineMetric.connectedCallback?.();
  const inline = component(harness, "pi-data-source", {
    name: "inline",
    "data-pi-export-json": '{"total":99}',
  });
  inline.connectedCallback?.();
  assert.equal(harness.fetchCalls.length, 1);
  assert.equal(inlineMetric.children[1]?.textContent, "99");
});

test("table and chart consume feed values and clean up safely", async () => {
  const harness = await createHarness();
  const table = component(harness, "pi-table", {
    "data-feed": "sales",
    field: "rows",
  });
  table.connectedCallback?.();
  const chart = component(harness, "pi-chart", {
    "data-feed": "sales",
    field: "chart",
  });
  chart.connectedCallback?.();

  harness.data.publish("sales", {
    rows: [{ name: "<img src=x>", amount: 42 }],
    chart: { type: "bar", data: { labels: [], datasets: [] } },
  });

  const tableElement = table.children[0];
  const body = tableElement?.children.at(-1);
  const row = body?.children[0];
  assert.equal(row?.children[0]?.textContent, "<img src=x>");
  assert.equal(harness.chartInstances.length, 1);
  chart.disconnectedCallback?.();
  assert.equal(harness.chartInstances[0]?.destroyed, true);
});
