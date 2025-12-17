import {program} from 'commander'
import {execSync} from 'node:child_process'
import {readFileSync, writeFileSync} from "node:fs";
import path from "node:path";

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

    // Run the program
    const { objects } = await import("../" + outFilePath)
    // console.log(objects)
    const nodes = objects.map(o => {
        const links = []

        const parseArg = (arg) => {
            if (typeof arg === 'function')
            {
                if (arg.__tree) {
                    console.log(arg.__tree)
                    return 'Linked'
                }
                return 'Function'
            }
            if (typeof arg === 'object') {
                if (arg === null) return null

                return arg && Object.fromEntries(Object.entries(arg).map(([k, v]) => [k, parseArg(v)]).filter(([_, v]) => Boolean(v)))
            }
            return arg
        }

        return {
            id: o.tree.join('.'),
            label: o.name,
            args: parseArg(o.args)
        }
    })

    console.log(JSON.stringify(nodes))
}

main()
