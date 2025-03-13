# kumoya

[![npm](https://img.shields.io/npm/v/kumoya?style=flat-square)](https://www.npmjs.com/package/kumoya)
[![GitHub](https://img.shields.io/github/license/Hoshino-Yumetsuki/kumoya?style=flat-square)](https://github.com/cordiverse/kumoya/blob/master/LICENSE)

Kumoya 是一个零配置的 TypeScript 项目打包工具，作为 Dumble 构建器的 rolldown 实现。该仓库作为 Yakumo 嵌套工作区管理器的非官方扩展工具集发布。

它会自动读取 `tsconfig.json` 和 `package.json` 来确定需要打包的文件、所需的格式、输出文件的位置等信息。

灵感来源于 [pkgroll](https://github.com/privatenumber/pkgroll)。

## 快速开始

1. 安装：

```sh
npm install --save-dev kumoya
```

2. 添加 `build` 脚本：

```json
{
    "scripts": {
        "build": "tsc -b && kumoya"
    }
}
```

注意：`kumoya` 旨在与 `tsc`（TypeScript 编译器）一起使用。`tsc` 用于类型检查和生成 `.d.ts` 文件，而 `kumoya` 用于打包和对 `.js` 文件进行 tree-shaking。

3. 开始构建：

```sh
npm run build
```

## 配置

在大多数情况下，您不需要配置任何内容。以下是您可以在 `tsconfig.json` 和 `package.json` 中设置的一些属性，以便自定义构建过程。

```json5
// tsconfig.json
{
    "compilerOptions": {
        // 输入和输出目录
        "rootDir": "src",
        "outDir": "lib",

        // 如果您需要 .d.ts 文件，
        // 请将 "declaration" 和 "emitDeclarationOnly" 设置为 true
        "declaration": true,
        "emitDeclarationOnly": true,

        // 如果您不需要 .d.ts 文件，
        // 只需将 "noEmit" 设置为 true
        "noEmit": true,

        // target 和 sourcemaps 也会被识别
        "target": "esnext",
        "sourceMap": true,
    },
}
```

```json5
// package.json
{
    "name": "my-package",

    // 模块系统 (https://nodejs.org/api/packages.html#type)
    "type": "module",

    // 输出文件
    "main": "./dist/index.cjs",
    "module": "./dist/index.mjs",
    "types": "./dist/index.d.cts",

    // 导出映射 (https://nodejs.org/api/packages.html#exports)
    "exports": {
        "require": {
            "types": "./dist/index.d.cts",
            "default": "./dist/index.cjs"
        },
        "import": {
            "types": "./dist/index.d.mts",
            "default": "./dist/index.mjs"
        }
    },

    // bin 文件将被编译为可执行文件，并添加 Node.js hashbang
    "bin": "./dist/cli.js",
}
```

## 基本用法

### 入口点和导出

| `package.json` 属性   | 输出格式      |
| ------------------- | ------------ |
| main                | 自动检测       |
| module              | esmodule     |
| types               | declaration  |
| exports.*           | 自动检测       |
| exports.*.require   | commonjs     |
| exports.*.import    | esmodule     |
| bin                 | 自动检测       |

自动检测基于扩展名和 `package.json` 中的 [`type`](https://nodejs.org/api/packages.html#type) 字段：

| 扩展名   | 类型                                                   |
| ------- | ------------------------------------------------------ |
| `.cjs`  | commonjs                                               |
| `.mjs`  | esmodule                                               |
| `.js`   | 如果 `type` 是 `"module"`，则为 esmodule，否则为 commonjs |

### 依赖打包

通过读取 `package.json` 中的依赖类型来确定哪些包需要外部化：

| 依赖类型                | 行为     |
| ---------------------- | -------- |
| `dependencies`         | 外部化   |
| `peerDependencies`     | 外部化   |
| `optionalDependencies` | 外部化   |
| `devDependencies`      | 打包     |
| 未列出                  | 报错     |

## 更多选项

尽管 kumoya 尽最大努力推断您所需的配置，但在某些情况下，您可能希望手动自定义构建。基本上，所有额外选项都与 [esbuild](https://esbuild.github.io) CLI 一致。

### 目标环境

`target` 会自动从 `tsconfig.json` 中检测。如果您想覆盖它，可以设置 `--target` 选项。

```sh
kumoya --target=node14
```

### 源映射

`sourceMap` 会自动从 `tsconfig.json` 中检测，但它只支持 `boolean` 值。如果您想进一步自定义，可以设置 `--sourcemap` 选项。

```sh
kumoya --sourcemap=inline
```

### 压缩

Kumoya 默认会压缩您的代码。如果您想禁用压缩，可以设置 `--no-minify` 选项。

```sh
kumoya --no-minify
```

## 致谢

Kumoya 最初是作为 [Dumble](https://github.com/cordiverse/dumble)（一个 TypeScript 构建器）的 rolldown 实现开发的。没有 Dumble，就不会有 Kumoya。

该仓库作为 [Yakumo](https://github.com/shigma/yakumo)（一个嵌套工作区管理器）的非官方扩展工具集。它被设计为与 Yakumo 生态系统无缝集成，同时提供额外的打包功能。

[pkgroll](https://github.com/privatenumber/pkgroll) 是一个类似的项目，也是本项目的灵感来源。它实际上提供了更多功能，例如：

- `--watch`
- `.d.ts` 打包
- 基于 rollup 的压缩（比 esbuild 稍小）

如果您发现 kumoya 不能满足您的需求，可以考虑使用 yakumo 官方工具集并向其提出 issue 或 pull request。

与 pkgroll 相比，kumoya 更简单，更专注于零配置。此外，kumoya 可以轻松集成到具有多个包的 monorepo 中，并且可以进一步自定义。