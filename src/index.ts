import { program } from "commander";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import type { GraphData, GraphNode } from "../shared/types";

const main = async () => {
  program
    .option(
      "-p <manager>",
      "Specify package manager to use, defaults to npm",
      "npm",
    )
    .argument(
      "<path>",
      "Path to the project (directory containing package.json)",
    );

  program.parse();

  const options = program.opts();
  const [projectPath] = program.args;

  // Selected package manager (defaults to npm). Accepts npm | pnpm | yarn | etc.
  const packageManager: string = options.p;

  console.log(
    `Installing dependencies for ${projectPath} using ${packageManager}...`,
  );
  const execOptions = {
    cwd: projectPath,
    stdio: "inherit",
  } as const;

  // 1) Install the Pulumi project's dependencies
  execSync(`${packageManager} install`, execOptions);

  // 2) Transpile TypeScript to JavaScript (no .d.ts needed)
  execSync(`npx tsc --declaration false`, execOptions);

  // 3) Bundle to a single JS file to simplify mocking/injection
  execSync(
    `npx esbuild dist/index.js --bundle --outfile=out/index.js --platform=node --packages=external`,
    execOptions,
  );

  // 4) Inject our Pulumi mocking layer (see src/inject.js)
  const injectContent = readFileSync(
    path.join(__dirname, "./inject.js"),
    "utf8",
  );
  const outFilePath = path.join(projectPath, "out/index.js");

  const bundleSource = readFileSync(outFilePath, "utf8");
  const injectedSource = bundleSource.replace('"use strict";\n', injectContent);
  writeFileSync(outFilePath, injectedSource);

  // 5) Run the instrumented Pulumi program. It won't deploy anything, but it will output the objects that were created.
  // A Pulumi object is a class instantiated with `new`. They will be represented as nodes in the graph.
  // The links between nodes represent the arguments passed to the constructor of the Pulumi object that
  // depend on other objects.
  const { objects } = await import("../" + outFilePath);

  // Helpers to produce a flattened key map for args (Mongo-style dot paths)
  const isPlainObject = (v: any) =>
    Object.prototype.toString.call(v) === "[object Object]";
  const flattenArgs = (value: any, prefix = ""): Record<string, unknown> => {
    const out: Record<string, string> = {};
    const push = (key: string, v: any) => {
      out[key] = v;
    };

    const recur = (val: any, pref: string) => {
      if (val == null) {
        push(pref, val);
        return;
      }
      if (isPlainObject(val)) {
        const keys = Object.keys(val);
        if (keys.length === 0) {
          push(pref, "{}");
          return;
        }
        keys.forEach((k) => {
          const np = pref ? `${pref}.${k}` : k;
          recur((val as any)[k], np);
        });
        return;
      }
      if (Array.isArray(val)) {
        if (val.length === 0) {
          push(pref, "[]");
          return;
        }
        val.forEach((item, idx) => {
          const np = pref ? `${pref}.${idx}` : String(idx);
          recur(item, np);
        });
        return;
      }
      push(pref, val);
    };

    if (isPlainObject(value) || Array.isArray(value)) {
      recur(value, prefix);
    } else if (prefix) {
      out[prefix] = value;
    } else {
      out["value"] = value;
    }
    return out;
  };

  // 6) Convert captured objects to the typed GraphData consumed by the UI
  const nodes: GraphData = objects.map((o) => {
    const flattened = flattenArgs(o.args);
    const formatted = Object.entries(flattened).map(([key, value]) => {
      if ((value as any)?.__tree) {
        const t = (value as any).__tree as any[];
        if (typeof t[0] !== "number")
          return [key, { type: "text", content: t.join("") }] as const;
        return [
          key,
          {
            type: "link",
            prop: t.slice(1).join(""),
            source: t[0],
          },
        ] as const;
      }
      return [key, { type: "text", content: JSON.stringify(value) }] as const;
    });

    const node: GraphNode = {
      pulumiClass: o.tree.join(""),
      label: o.name,
      argsFlat: formatted,
    };
    return node;
  });

  const graphJson = JSON.stringify(nodes, null, 2);

  // Start a tiny local server to serve the UI and the graph data
  try {
    const uiDistDir = path.join(process.cwd(), "ui-dist");
    const uiPathDist = path.join(uiDistDir, "index.html");
    const jsonBuffer = Buffer.from(graphJson, "utf8");

    const server = http.createServer((req, res) => {
      const url = req.url || "/";
      // Serve static assets exclusively from ui-dist
      if (
        url === "/" ||
        url.startsWith("/index.html") ||
        url.startsWith("/assets/")
      ) {
        if (!existsSync(uiPathDist)) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end(
            "UI not built. Run 'npm run ui:build' to generate the React UI (ui-dist/) before running the demo.",
          );
          return;
        }
        const requested = url === "/" ? "index.html" : url.replace(/^\//, "");
        const rootDir = uiDistDir;
        const filePath = path.normalize(path.join(rootDir, requested));
        if (!filePath.startsWith(rootDir)) {
          res.writeHead(403, { "Content-Type": "text/plain" });
          res.end("Forbidden");
          return;
        }
        try {
          const data = readFileSync(filePath);
          const ext = path.extname(filePath).toLowerCase();
          const ctype =
            ext === ".html"
              ? "text/html; charset=UTF-8"
              : ext === ".js"
                ? "application/javascript; charset=UTF-8"
                : ext === ".css"
                  ? "text/css; charset=UTF-8"
                  : ext === ".map"
                    ? "application/json; charset=UTF-8"
                    : ext === ".svg"
                      ? "image/svg+xml"
                      : ext === ".png"
                        ? "image/png"
                        : "application/octet-stream";
          res.writeHead(200, { "Content-Type": ctype });
          res.end(data);
        } catch (e) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not found");
        }
        return;
      }
      if (url.startsWith("/data")) {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=UTF-8",
          "Cache-Control": "no-store",
        });
        res.end(jsonBuffer);
        return;
      }

      // Fallback 404
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const httpUrl = `http://127.0.0.1:${port}/`;
      console.log(`Graph UI available at ${httpUrl}`);

      // Attempt to open the default browser across platforms
      try {
        const platform = process.platform;
        if (platform === "win32") {
          // Using cmd /c start is reliable on Windows (empty title keeps quotes intact)
          execSync(`cmd /c start "" "${httpUrl}"`, { stdio: "ignore" });
        } else if (platform === "darwin") {
          execSync(`open "${httpUrl}"`, { stdio: "ignore" });
        } else {
          execSync(`xdg-open "${httpUrl}"`, { stdio: "ignore" });
        }
      } catch (e) {
        console.warn(
          "Failed to auto-open browser. Open this URL manually:",
          httpUrl,
        );
      }
    });
  } catch (e) {
    console.warn("Failed to start local server for UI:", e);
  }
};

main();
