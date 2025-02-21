import {
    dirname,
    extname,
    isAbsolute,
    join,
    relative,
    resolve
} from 'node:path'
import { isBuiltin } from 'node:module'
import { TsConfig } from 'tsconfig-utils'
import { rolldown, RolldownOptions, Plugin as RollupPlugin } from 'rolldown'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import yaml from 'js-yaml'
import globby from 'globby'
import terser from '@rollup/plugin-terser'

type Platform = 'browser' | 'node' | undefined

export const DependencyType = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies'
] as const
export type DependencyType = (typeof DependencyType)[number]

export interface PackageJsonExports {
    [key: string]: string | PackageJsonExports
}

export interface PackageJson
    extends Partial<Record<DependencyType, Record<string, string>>> {
    name: string
    type?: 'module' | 'commonjs'
    main?: string
    module?: string
    bin?: string | Record<string, string>
    exports?: PackageJsonExports
    description?: string
    private?: boolean
    version: string
    workspaces?: string[]
    peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

const ignored = [
    'This call to "require" will not be bundled because the argument is not a string literal',
    'Indirect calls to "require" will not be bundled',
    'should be marked as external for use with "require.resolve"'
]

async function bundle(options: RolldownOptions, base: string) {
    const entryPoints = options.input as Record<string, string>

    // show entry list
    for (const [key, value] of Object.entries(entryPoints)) {
        const source = relative(base, value)
        const outputDir = Array.isArray(options.output)
            ? options.output[0].dir
            : options.output?.dir
        const target = relative(base, resolve(outputDir!, key + '.js'))
        console.log('rolldown:', source, '->', target)
    }

    try {
        const bundle = await rolldown(options)
        await bundle.write({
            ...(Array.isArray(options.output)
                ? options.output[0]
                : options.output),
            format: Array.isArray(options.output)
                ? options.output[0].format || 'es'
                : options.output?.format || 'es'
        })
        await bundle.close()
    } catch (error) {
        console.error(error)
    }
}

const externalPlugin = ({
    cwd: _cwd,
    manifest,
    exports: _exports,
    tsconfig: _tsconfig
}: KumoyaData): RollupPlugin => ({
    name: 'external-library',
    resolveId(source: string, importer?: string) {
        if (!source) return null
        if (isAbsolute(source)) return null
        if (isBuiltin(source)) return { id: source, external: true }

        if (source.startsWith('.')) return null

        const name = source.startsWith('@')
            ? source.split('/', 2).join('/')
            : source.split('/', 1)[0]

        if (name === manifest.name) return { id: source, external: true }

        const types = new Set(
            DependencyType.filter((type) => manifest[type]?.[name])
        )
        if (types.size === 0) {
            throw new Error(`Missing dependency: ${name} from ${importer}`)
        }

        types.delete('devDependencies')
        return types.size > 0 ? { id: source, external: true } : null
    }
})

const yamlPlugin = (options: yaml.LoadOptions = {}): RollupPlugin => ({
    name: 'yaml',
    async transform(code, id) {
        if (!id.endsWith('.yml') && !id.endsWith('.yaml')) return null
        const parsed = yaml.load(code, options)
        return {
            code: `export default ${JSON.stringify(parsed)}`,
            map: { mappings: '' }
        }
    }
})

const hashbangPlugin = (binaries: string[]): RollupPlugin => ({
    name: 'hashbang',
    async transform(code: string, id: string) {
        if (!binaries.includes(id)) return null
        if (!code.startsWith('#!')) {
            code = '#!/usr/bin/env node\n' + code
        }
        return {
            code,
            map: { mappings: '' }
        }
    }
})

export interface KumoyaOptions {
    minify?: boolean
    env?: Record<string, string>
}

export interface KumoyaData {
    cwd: string
    manifest: PackageJson
    tsconfig: TsConfig
    exports: Record<string, Record<string, string>>
}

async function kumoya(
    cwd: string,
    manifest: PackageJson,
    tsconfig: TsConfig,
    options: KumoyaOptions = {}
) {
    const {
        rootDir = '',
        outFile,
        noEmit,
        emitDeclarationOnly,
        sourceMap
    } = tsconfig.compilerOptions
    if (!noEmit && !emitDeclarationOnly) return
    const outDir = tsconfig.compilerOptions.outDir ?? dirname(outFile!)

    const outdir = resolve(cwd, outDir)
    const outbase = resolve(cwd, rootDir)
    const matrix: RolldownOptions[] = []
    const exports: Record<string, Record<string, string>> = Object.create(null)
    const outFiles = new Set<string>()
    const binaries: string[] = []

    const resolveCache: Record<
        string,
        Promise<readonly [string, string[]] | undefined>
    > = Object.create(null)

    async function resolvePattern(pattern: string) {
        if (!pattern.startsWith(outDir + '/')) {
            // handle files like `package.json`
            pattern = pattern.replace('*', '**')
            const targets = await globby(pattern, { cwd })
            for (const target of targets) {
                // ignore exports in `rootDir`
                if (!relative(rootDir!, target).startsWith('../')) continue
                const filename = join(cwd, target)
                exports[filename] = { default: filename }
            }
            return
        }

        // https://nodejs.org/api/packages.html#subpath-patterns
        // `*` maps expose nested subpaths as it is a string replacement syntax only
        const outExt = extname(pattern)
        pattern =
            pattern
                .slice(outDir.length + 1, -outExt.length)
                .replace('*', '**') + '.{ts,tsx}'
        return [outExt, await globby(pattern, { cwd: outbase })] as const
    }

    async function addExport(
        pattern: string | undefined,
        preset: RolldownOptions,
        prefix: string | null = '',
        isBinary = false
    ) {
        if (!pattern) return
        if (pattern.startsWith('./')) pattern = pattern.slice(2)
        const result = await (resolveCache[pattern] ??= resolvePattern(pattern))
        if (!result) return

        // transform options by extension
        const [outExt, targets] = result
        preset = { ...preset }
        if (outExt === '.cjs') {
            preset.output = { ...preset.output, format: 'cjs' }
        } else if (outExt === '.mjs') {
            preset.output = { ...preset.output, format: 'es' }
        }

        for (const target of targets) {
            const srcFile = join(cwd, rootDir, target)
            if (isBinary) binaries.push(srcFile)
            const srcExt = extname(target)
            const entry = target.slice(0, -srcExt.length)
            const outFile = join(outdir, entry + outExt)
            if (outFiles.has(outFile)) return
            outFiles.add(outFile)
            if (!preset.platform) {
                ;(exports[srcFile] ||= {}).types = `${manifest.name}/${prefix!}`
            } else {
                ;(exports[srcFile] ||= {})[preset.platform] = outFile
            }

            matrix.push({
                input: { [entry]: srcFile },
                output: {
                    dir: outdir,
                    format: Array.isArray(preset.output)
                        ? preset.output[0].format === 'es'
                            ? 'es'
                            : 'cjs'
                        : preset.output?.format === 'es'
                          ? 'es'
                          : 'cjs',
                    sourcemap: sourceMap,
                    preserveModules: true,
                    exports: 'auto'
                },
                external: [],
                plugins: [
                    nodeResolve(),
                    yamlPlugin(),
                    externalPlugin({ cwd, manifest, exports, tsconfig }),
                    hashbangPlugin(binaries),
                    // @ts-expect-error
                    options.minify !== false && terser()
                ].filter(Boolean)
            })
        }
    }

    const tasks: Promise<void>[] = []

    // TODO: support null targets
    function addConditionalExport(
        pattern: string | PackageJsonExports | undefined,
        preset: RolldownOptions,
        prefix = ''
    ) {
        if (typeof pattern === 'string') {
            tasks.push(addExport(pattern, preset, prefix))
            return
        }

        for (const key in pattern) {
            if (key === 'require') {
                addConditionalExport(
                    pattern[key],
                    { ...preset, output: { format: 'cjs' } },
                    prefix
                )
            } else if (key === 'import') {
                addConditionalExport(
                    pattern[key],
                    { ...preset, output: { format: 'es' } },
                    prefix
                )
            } else if (['browser', 'node'].includes(key)) {
                addConditionalExport(
                    pattern[key],
                    { ...preset, platform: key as Platform },
                    prefix
                )
            } else if (['types', 'typings'].includes(key)) {
                // use `undefined` to indicate `.d.ts` files
                addConditionalExport(
                    pattern[key],
                    { ...preset, platform: undefined },
                    prefix
                )
            } else {
                addConditionalExport(
                    pattern[key],
                    preset,
                    key.startsWith('.') ? join(prefix, key) : prefix
                )
            }
        }
    }

    const preset: RolldownOptions = {
        platform: 'node',
        output: {
            format: manifest.type === 'module' ? 'es' : 'cjs'
        }
    }

    tasks.push(addExport(manifest.main, preset))
    tasks.push(
        addExport(manifest.module, {
            ...preset,
            output: { ...preset.output, format: 'es' }
        })
    )
    addConditionalExport(manifest.exports, preset)

    if (!manifest.exports) {
        // do not bundle `package.json`
        tasks.push(addExport('package.json', preset, null))
    }

    if (typeof manifest.bin === 'string') {
        tasks.push(addExport(manifest.bin, preset, null, true))
    } else if (manifest.bin) {
        for (const key in manifest.bin) {
            tasks.push(addExport(manifest.bin[key], preset, null, true))
        }
    }

    await Promise.all(tasks)

    await Promise.all(
        matrix.map(async (options) => {
            try {
                await bundle(options, process.cwd())
            } catch (error) {
                console.error(error)
            }
        })
    )
}

export default kumoya
