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

async function bundle(options: RolldownOptions) {
  const base = process.cwd()
  const entryPoints = options.input as Record<string, string>

  // 获取输出配置
  const outputConfig = Array.isArray(options.output)
    ? options.output[0]
    : options.output

  // show entry list
  for (const [key, value] of Object.entries(entryPoints)) {
    const source = relative(base, value)
    const outputDir = outputConfig?.dir
    const target = relative(base, resolve(outputDir!, key))
    console.log('rolldown:', source, '->', target)
  }

  try {
    const bundle = await rolldown(options)
    await bundle.write({
      ...outputConfig,
      format: outputConfig?.format || 'es',
      entryFileNames: '[name]'
    })
    await bundle.close()
  } catch (error) {
    console.error(error)
  }
}

const externalPlugin = ({
  cwd,
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
  build?: (options: RolldownOptions, callback: (options: RolldownOptions) => Promise<void>) => Promise<void>
}

export interface KumoyaData {
  cwd: string
  manifest: PackageJson
  tsconfig: TsConfig
  exports: Record<string, Record<string, string>>
}

function getOutputExtension(manifest: any): string {
  if (manifest.exports) {
    const mainExport =
      typeof manifest.exports === 'object'
        ? manifest.exports['.']?.import || manifest.exports['.']?.require
        : manifest.exports
    if (mainExport) return extname(mainExport)
  }

  if (manifest.main) {
    return extname(manifest.main)
  }

  return manifest.type === 'module' ? '.mjs' : '.cjs'
}

async function kumoya(
  cwd: string,
  manifest: PackageJson,
  tsconfig: TsConfig,
  _options: KumoyaOptions = {}
) {
  const options = _options
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
      pattern = pattern.replace('*', '**')
      const targets = await globby(pattern, { cwd })
      for (const target of targets) {
        if (!relative(rootDir!, target).startsWith('../')) continue
        const filename = join(cwd, target)
        exports[filename] = { default: filename }
      }
      return
    }
    const outExt = extname(pattern)
    const basePattern = pattern.slice(outDir.length + 1, -outExt.length)
    pattern = basePattern.replace('*', '**') + '.{ts,tsx}'
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
    if (extname(pattern) === '.js') {
      const targetExt = getOutputExtension(manifest)
      pattern = pattern.slice(0, -3) + targetExt
    }

    const result = await (resolveCache[pattern] ??= resolvePattern(pattern))
    if (!result) return

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
        input: { [entry + outExt]: srcFile },
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
          exports: 'auto',
          entryFileNames: '[name]'
        },
        external: [],
        plugins: [
          yamlPlugin(),
          externalPlugin({ cwd, manifest, exports, tsconfig }),
          hashbangPlugin(binaries),
          options.minify &&
            terser({
              output: {
                ascii_only: true
              }
            })
        ].filter(Boolean) as RolldownOptions['plugins']
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

  const build = _options.build ?? ((options, callback) => callback(options))

  await Promise.all(
    matrix.map(async (options) => {
      try {
        await build(options, bundle)
      } catch (error) {
        console.error(error)
      }
    })
  )
}

export default kumoya
