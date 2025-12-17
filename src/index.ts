import {program} from 'commander'
import {execSync} from 'node:child_process'
import {readFileSync, writeFileSync} from "node:fs";
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
    const nodes = objects.map(o => {
        const links: Array<{ nodeIndex: number, prop: string }> = []

        const parseArg = (arg) => {
            if (typeof arg === 'function') {
                if (arg.__tree) {
                    if (typeof arg.__tree[0] !== 'number')
                        return arg.__tree.join('.')
                    links.push({
                        nodeIndex: arg.__tree[0],
                        prop: arg.__tree.slice(1).join('.'),
                    })
                    return 'Link ' + (links.length - 1)
                }
                return 'Function'
            }
            if (typeof arg === 'object') {
                return arg && Object.fromEntries(Object.entries(arg).map(([k, v]) => [k, parseArg(v)]).filter(([_, v]) => Boolean(v)))
            }
            return arg
        }

        return {
            pulumiClass: o.tree.join('.'),
            label: o.name,
            args: parseArg(o.args),
            links
        }
    })

    const json = JSON.stringify(nodes, null, 2)
    console.log(json)

    // Open UI with base64-encoded data
    try {
        const base64 = Buffer.from(json, 'utf8').toString('base64')
        const uiPath = path.join(process.cwd(), 'ui', 'index.html')
        const fileUrl = 'file:///' + uiPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1:') + '#data=' + base64

        console.log('Opening UI with graph data...')
        const platform = process.platform
        if (platform === 'win32') {
            execSync(`start "" "${fileUrl}"`, { stdio: 'ignore', cwd: process.cwd() })
        } else if (platform === 'darwin') {
            execSync(`open "${fileUrl}"`, { stdio: 'ignore', cwd: process.cwd() })
        } else {
            execSync(`xdg-open "${fileUrl}"`, { stdio: 'ignore', cwd: process.cwd() })
        }
    } catch (e) {
        console.warn('Failed to auto-open UI. You can open ui/index.html manually and paste the data.', e)
    }
}

main()
