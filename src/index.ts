import {program} from 'commander'
import {execSync} from 'node:child_process'
import {readFileSync, writeFileSync} from "node:fs";
import http from 'node:http'
import path from "node:path";
import {type} from "node:os";

const main = async () => {
    program
        .option('-p <manager>', "Specify package manager to use, defaults to npm", "npm")
        .argument('<path>', 'Path to the project (directory containing package.json)')

    program.parse();

    const options = program.opts();
    const [p] = program.args

    console.log(`Installing dependencies for ${p} using ${options.p}...`)
    const commandOpt = {
        cwd: p,
        stdio: 'inherit'
    } as const

    // Install pulumi dependencies
    execSync(`${options.p} install`, commandOpt)

    // Transform to JS
    execSync(`npx tsc --declaration false`, commandOpt)

    // Concat to single file
    execSync(`npx esbuild dist/index.js --bundle --outfile=out/index.js --platform=node --packages=external`, commandOpt)

    // Add require mock
    const injectContent = readFileSync(path.join(__dirname, './inject.js'), 'utf8')
    const outFilePath = path.join(p, 'out/index.js')

    const contents = readFileSync(outFilePath, 'utf8')
    const mocked = contents.replace('"use strict";\n', injectContent)
    writeFileSync(outFilePath, mocked)

    // Run the Pulumi program. It won't deploy anything, but it will output the objects that were created.
    // A Pulumi object is a class instantiated with `new`. They will be represented as nodes in the graph.
    // The links between nodes represent the arguments passed to the constructor of the Pulumi object that
    // depend on other objects.
    const { objects } = await import("../" + outFilePath)

    // Helpers to produce a flattened key map for args (Mongo-style dot paths)
    const isPlainObject = (v: any) => Object.prototype.toString.call(v) === '[object Object]'
    const formatValue = (val: any): string => {
        if (val == null) return String(val)
        if (typeof val === 'string') return val
        if (typeof val === 'number' || typeof val === 'boolean') return String(val)
        if (typeof val === 'function') return '[Function]'
        try { return JSON.stringify(val) } catch { return String(val) }
    }
    const flattenArgs = (value: any, prefix = ''): Record<string, unknown> => {
        const out: Record<string, string> = {}
        const push = (key: string, v: any) => { out[key] = v }

        const recur = (val: any, pref: string) => {
            if (val == null) { push(pref, val); return }
            if (isPlainObject(val)) {
                const keys = Object.keys(val)
                if (keys.length === 0) { push(pref, '{}'); return }
                keys.forEach(k => {
                    const np = pref ? `${pref}.${k}` : k
                    recur((val as any)[k], np)
                })
                return
            }
            if (Array.isArray(val)) {
                if (val.length === 0) { push(pref, '[]'); return }
                val.forEach((item, idx) => {
                    const np = pref ? `${pref}.${idx}` : String(idx)
                    recur(item, np)
                })
                return
            }
            push(pref, val)
        }

        if (isPlainObject(value) || Array.isArray(value)) {
            recur(value, prefix)
        } else if (prefix) {
            out[prefix] = value
        } else {
            out['value'] = value
        }
        return out
    }

    const nodes = objects.map(o => {
        const argsFlat = flattenArgs(o.args)
        const argsFormat = Object.entries(argsFlat).map(([k, v]) => {
            if (v?.__tree) {
                if (typeof v.__tree[0] !== 'number')
                    return [k, {type: 'text', content: v.__tree.join('.')}]as const
                return [k, { type: 'link', prop: v.__tree.slice(1).join('.'), source: v.__tree[0] }]as const
            }
            return [k, {type:'text',content:JSON.stringify(v)}] as const
        })

        return {
            pulumiClass: o.tree.join('.'),
            label: o.name,
            argsFlat: argsFormat,
        }
    })

    const json = JSON.stringify(nodes, null, 2)
    console.log(json)

    // Start a tiny local server to serve the UI and the graph data
    try {
        const uiPath = path.join(process.cwd(), 'ui', 'index.html')
        const jsonBuffer = Buffer.from(json, 'utf8')

        const server = http.createServer((req, res) => {
            const url = req.url || '/'
            if (url === '/' || url.startsWith('/index.html')) {
                try {
                    const html = readFileSync(uiPath)
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' })
                    res.end(html)
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' })
                    res.end('Failed to load UI')
                }
                return
            }
            if (url.startsWith('/data')) {
                res.writeHead(200, {
                    'Content-Type': 'application/json; charset=UTF-8',
                    'Cache-Control': 'no-store'
                })
                res.end(jsonBuffer)
                return
            }

            // Fallback 404
            res.writeHead(404, { 'Content-Type': 'text/plain' })
            res.end('Not found')
        })

        server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            const port = typeof address === 'object' && address ? address.port : 0
            const httpUrl = `http://127.0.0.1:${port}/`
            console.log(`Graph UI available at ${httpUrl}`)

            try {
                const platform = process.platform
                if (platform === 'win32') {
                    // Use cmd built-in reliably
                    execSync(`cmd /c start "" "${httpUrl}"`, { stdio: 'ignore' })
                } else if (platform === 'darwin') {
                    execSync(`open "${httpUrl}"`, { stdio: 'ignore' })
                } else {
                    execSync(`xdg-open "${httpUrl}"`, { stdio: 'ignore' })
                }
            } catch (e) {
                console.warn('Failed to auto-open browser. Open this URL manually:', httpUrl)
            }
        })
    } catch (e) {
        console.warn('Failed to start local server for UI:', e)
    }
}

main()
