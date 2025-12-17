import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import type { GraphData } from "../../shared/types";
import { LinkIcon } from "./LinkIcon";

function toElements(nodes: GraphData): ElementDefinition[] {
  const elements: ElementDefinition[] = [];
  nodes.forEach((n, i) => {
    const label = (n.label || n.pulumiClass || String(i)).replace(
      /-/g,
      "-\u200b",
    );
    const classes = (n.pulumiClass || "").replace(/\./g, " ");
    elements.push({
      data: { id: String(i), label, pulumiClass: n.pulumiClass || "" },
      classes,
    });
  });
  nodes.forEach((n, i) => {
    const target = String(i);
    n.argsFlat
      .map(([, v]) => v)
      .filter((a) => a.type === "link")
      .forEach((l, idx) => {
        const source = String(l.source);
        const id = `e-${i}-${idx}-${source}`;
        const label = l.prop || "";
        elements.push({ data: { id, source, target, label } });
      });
  });
  return elements;
}

const cyStyles: cytoscape.StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      "background-color": "#4f46e5",
      label: "data(label)",
      color: "#ffffff",
      "font-size": 10,
      "text-wrap": "wrap",
      "text-max-width": "50",
      "text-valign": "center",
      "text-halign": "center",
      padding: "5px",
      shape: "round-rectangle",
      "border-color": "#4338ca",
      "border-width": 1,
      width: 55,
      height: 55,
    },
  },
  {
    selector: "edge",
    style: {
      "curve-style": "bezier",
      "target-arrow-shape": "triangle",
      "target-arrow-color": "#9ca3af",
      "line-color": "#9ca3af",
      width: 1.5,
      label: "data(label)",
      "font-size": 9,
      "text-background-color": "#f3f4f6",
      "text-background-opacity": 1,
      "text-background-padding": "2px",
      "text-rotation": "autorotate",
    },
  },
];

export const App: React.FC = () => {
  const [data, setData] = useState<GraphData>([]);
  const [selection, setSelection] = useState<number>();
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch("/data", { cache: "no-store" });
        const json: GraphData = await res.json();
        if (!cancelled) setData(json);
      } catch (e) {
        console.error("Failed to fetch /data", e);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const elements = useMemo(() => toElements(data), [data]);

  useEffect(() => {
    const container = document.getElementById("cy") as HTMLDivElement | null;
    if (!container) return;
    const cy = cytoscape({
      container,
      elements,
      style: cyStyles,
      layout: { name: "cose", animate: false },
    });
    cyRef.current = cy;
    const layout = cy.layout({ name: "cose", animate: false, fit: true });
    layout.run();
    const onTap = (evt: any) => {
      const node = evt.target;
      const id: string = node.id();
      setSelection(Number(id));
    };
    cy.on("tap", "node", onTap);
    return () => {
      cy.off("tap", "node", onTap);
      cy.destroy();
    };
  }, [elements, data]);

  const handleFit = useCallback(() => cyRef.current?.fit(), []);
  const handleLayout = useCallback(
    () =>
      cyRef.current?.layout({ name: "cose", animate: false, fit: true }).run(),
    [],
  );
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    } catch {}
  }, [data]);

  return (
    <div id="app">
      <header>
        <h1>Pulumi Graph Viewer</h1>
        <div className="controls">
          <button onClick={handleFit} title="Fit to screen">
            Fit
          </button>
          <button onClick={handleLayout} title="Re-run layout">
            Layout
          </button>
          <button onClick={handleCopy} title="Copy raw JSON">
            Copy JSON
          </button>
        </div>
      </header>
      <div className="content">
        <aside id="sidepanel">
          <h2>Details</h2>
          <Details
            selection={selection}
            graphData={data}
            setSelection={setSelection}
          />
        </aside>
        <div id="cy" />
      </div>
    </div>
  );
};

const Details: React.FC<{
  selection?: number;
  graphData: GraphData;
  setSelection: (selection: number) => void;
}> = ({ selection, graphData, setSelection }) => {
  if (selection === undefined)
    return <div className="muted">Click a node to see its properties.</div>;
  const data = graphData[selection];
  return (
    <div>
      <div>
        <strong>Label:</strong> {data.label}
      </div>
      <div>
        <strong>Pulumi class:</strong> {data.pulumiClass}
      </div>
      <div style={{ marginTop: 8 }}>
        <strong>Args</strong> (flattened):
      </div>
      <table className="kv" style={{ marginTop: 4 }}>
        <tbody>
          {data.argsFlat.length === 0 && (
            <tr>
              <td className="muted" colSpan={2}>
                No args
              </td>
            </tr>
          )}
          {data.argsFlat.map(([k, v]) => (
            <tr key={k}>
              <th className="mono">{k}</th>
              <td className="mono value-cell">
                {v.type === "text" ? (
                  v.content
                ) : (
                  <>
                    <a onClick={() => setSelection(v.source)}>
                      <LinkIcon size={16} />
                      {graphData[v.source]?.label}
                    </a>
                    {v.prop}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default App;
