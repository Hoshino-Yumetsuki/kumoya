#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { cac } from 'cac'
import { load } from 'tsconfig-utils'
import dumble from './index.js'

const cli = cac('dumble [name]')
    .option('-nm, --no-minify', 'Do not minify output')
    .option('--env <env>', 'Compile-time environment variables')
    .help()

const argv = cli.parse()

if (!argv.options.help) {
    for (const path of argv.args.length ? argv.args : ['.']) {
        const cwd = resolve(process.cwd(), path)
        const manifest = await readFile(join(cwd, 'package.json'), 'utf8').then(
            JSON.parse
        )
        const tsconfig = await load(cwd)
        await dumble(cwd, manifest, tsconfig, argv.options)
    }
}
