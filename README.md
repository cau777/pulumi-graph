Pulumi Graph
============

A small tool to execute a Pulumi program with mocked Pulumi APIs, capture the resource graph, and visualize it in a browser.

It does not deploy anything. Instead, it records which Pulumi resources would be created and which resources are referenced by others, then renders a dependency graph.

Features
--------

- Runs any Pulumi TypeScript project without deploying
- Captures resources and their argument references (dependencies)
- Serves a local web UI (React + Cytoscape) to visualize the graph
- Click a node to see all of its properties; args are shown as flattened dot-keys (e.g., `a.b.0.c`)
- Edges point from dependency → dependent
- Cross‑platform auto‑open of the browser

Quick Start
-----------

1. Build the web UI:
   - `npm run ui:build`

2. Run the demo against the included sample project:
   - `npm run demo`

This will:
- Install the Pulumi project’s dependencies
- Transpile and bundle the project
- Inject a small mock layer to intercept Pulumi calls
- Execute the bundled program to collect resources
- Start a tiny HTTP server and open the UI in your browser

If auto‑open fails, copy the printed URL and open it manually.

![project screenshot](https://github.com/cau777/pulumi-graph/blob/master/screenshot.png)

Using with Your Own Project
---------------------------

```
npm run pulumi-graph -- ./path-to-your-pulumi-project
```

The path must be the directory containing that project’s `package.json`.

Scripts
-------

- `npm run pulumi-graph` — Run the capture + local UI server
- `npm run ui:build` — Build the React UI (outputs to `ui-dist/`)
- `npm run typecheck` — Check types
- `npm run format` — Format with Prettier defaults
- `npm run format:check` — Check formatting only

Architecture Overview
---------------------

- `src/index.ts`
  - CLI entry. Installs deps, compiles, bundles, injects mocks, executes the Pulumi program, shapes graph data, and starts the local HTTP server.
  - Serves:
    - `/` — React UI (from `ui-dist/`)
    - `/data` — The generated graph JSON
- `src/inject.js`
  - Proxy‑based mock that intercepts Pulumi imports to record object construction and argument links.
- `shared/types.ts`
  - Shared TypeScript types used by both backend and frontend (`GraphNode`, `GraphData`, etc.).
- `web/`
  - React UI (Vite + TS) that fetches `/data` and renders the graph with Cytoscape.
  - Built assets land in `ui-dist/`.

Data Model
----------

`/data` returns an array of nodes (`GraphData`). For each node:
- `label` — Resource name
- `pulumiClass` — Fully qualified Pulumi class
- `argsFlat` — Array of `[key, value]` where `key` is a flattened path (e.g., `spec.template.0.name`) and `value` is either:
  - `{ type: 'text', content: string }` — A literal value
  - `{ type: 'link', prop: string, source: number }` — A reference to another node index with the property path that created the edge

Edges in the UI are created for each `link` value: `source` (dependency) → current node (dependent). The edge label is `prop`.

Development Notes
-----------------

- The server binds to `127.0.0.1` with a random available port and prints the URL.
- The process stays running to serve the UI; press Ctrl+C to stop.

Troubleshooting
---------------

- Browser didn’t open:
  - Copy the printed URL from the terminal and open it manually.
- UI shows 404:
  - Ensure you built the UI first with `npm run ui:build`.
- Graph is empty:
  - Verify your Pulumi program constructs resources synchronously during module evaluation so they are captured by the mock layer.

License
-------

MIT
