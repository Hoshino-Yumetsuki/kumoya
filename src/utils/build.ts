import * as esbuild from "esbuild";
import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import { BuilderOptions, KumoyaConfig } from "../types";
import * as fs from "fs";
import { minimatch } from "minimatch";
import { BuildError, logger } from "./logger";
import { DtsBundler } from "./dts-bundler";
import * as ts from "typescript";

const execAsync = promisify(exec);

interface DtsModule {
  content: string;
  imports: Set<string>;
  exports: Set<string>;
  references: string[];
}

export class Builder {
  private config: KumoyaConfig;
  private esbuildConfig: any;
  private tsConfig: any;

  constructor(options: BuilderOptions) {
    this.config = {
      platform: "node",
      format: "cjs",
      ...options.kumoyaConfig,
    } as KumoyaConfig;

    if (
      this.config.format === "both" &&
      this.config.extension &&
      this.config.extension !== "js"
    ) {
      throw new BuildError(
        "Cannot specify custom extension when format is 'both'",
      );
    }

    if (
      this.config.extension &&
      !["js", "cjs", "mjs"].includes(this.config.extension)
    ) {
      throw new BuildError("Extension must be one of: js, cjs, mjs");
    }

    if (this.config.outputFolder && this.config.outfile) {
      throw new Error("outputFolder and outfile cannot be used together");
    }
    if (this.config.outfile && !this.config.bundle) {
      throw new Error("outfile requires bundle to be true");
    }

    try {
      const tsConfigPath = path.join(process.cwd(), "tsconfig.json");
      this.tsConfig = JSON.parse(fs.readFileSync(tsConfigPath, "utf-8"));

      if (!this.config.target) {
        const tsTarget = this.tsConfig?.compilerOptions?.target?.toLowerCase();
        if (tsTarget) {
          this.config.target = tsTarget;
          logger.info(`Using target from tsconfig.json: ${this.config.target}`);
        }
      } else if (typeof this.config.target === "string") {
        this.config.target = this.config.target.toLowerCase();
      }
    } catch (error) {
      logger.warn(
        "Failed to read tsconfig.json, using default target settings",
      );
      this.tsConfig = {};
    }

    if (!this.config.outputFolder && !this.config.outfile) {
      this.config.outputFolder =
        this.tsConfig?.compilerOptions?.outDir || "dist";
    }

    this.esbuildConfig = options.esbuildConfig;
  }

  private getOutputExtension(format: "esm" | "cjs"): string {
    if (this.config.format === "both") {
      return format === "esm" ? ".mjs" : ".cjs";
    }
    return this.config.extension ? `.${this.config.extension}` : ".js";
  }

  private async buildWithEsbuild(entry: string, format: "esm" | "cjs" = "cjs") {
    let outputFile: string;

    if (this.config.outfile) {
      outputFile = this.config.outfile;
      const ext = path.extname(this.config.outfile);
      format = ext === "mjs" ? "esm" : "cjs";
    } else {
      const extension = this.getOutputExtension(format);
      outputFile = path.join(
        this.config.outputFolder!,
        `${path.parse(entry).name}${extension}`,
      ).replace(/\\/g, '/');
    }

    if (this.config.packages && this.config.external) {
      throw new BuildError("Cannot use both 'packages' and 'external' options");
    }

    const buildOptions: any = {
      entryPoints: [entry],
      bundle: this.config.bundle,
      outfile: outputFile,
      packages: this.config.packages || "external",
      platform: this.config.platform || "node",
      format,
      target: this.config.target || "es2015",
    };

    if (this.config.minify !== undefined)
      buildOptions.minify = this.config.minify;
    if (this.config.sourcemap !== undefined)
      buildOptions.sourcemap = this.config.sourcemap;
    if (this.config.treeShaking !== undefined)
      buildOptions.treeShaking = this.config.treeShaking;
    if (this.config.logLevel) buildOptions.logLevel = this.config.logLevel;
    if (this.config.external?.length)
      buildOptions.external = this.config.external;

    logger.info(`${path.posix.normalize(entry)} ==> ${path.posix.normalize(outputFile)}`);

    await esbuild.build({
      ...buildOptions,
      ...this.esbuildConfig,
    });
  }

  private getEntryDirs(): { [dir: string]: string[] } {
    const entries = Array.isArray(this.config.entry)
      ? this.config.entry
      : [this.config.entry];

    return entries.reduce((acc: { [dir: string]: string[] }, entry) => {
      const dir = path.dirname(entry);
      acc[dir] = acc[dir] || [];
      acc[dir].push(entry);
      return acc;
    }, {});
  }

  private isInTsConfig(filePath: string): boolean {
    const include = this.tsConfig?.include || [];
    const exclude = this.tsConfig?.exclude || [];

    return (
      include.some((pattern: string) => minimatch(filePath, pattern)) &&
      !exclude.some((pattern: string) => minimatch(filePath, pattern))
    );
  }

  private normalizePath(p: string): string {
    return p.replace(/\\/g, '/');
  }

  private async buildTypes() {
    const tmpDir = path.join(process.cwd(), ".kumoyatmp").replace(/\\/g, '/');
    const entryDirs = this.getEntryDirs();
    const dirs = Object.keys(entryDirs);
    const dtsBundler = new DtsBundler();

    try {
      if (this.config.bundle) {
        // 解析 tsconfig.json
        const tsConfigPath = path.join(process.cwd(), "tsconfig.json");
        const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
        const parsedConfig = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          path.dirname(tsConfigPath)
        );

        // 创建编译选项
        const compilerOptions: ts.CompilerOptions = {
          ...parsedConfig.options,
          declaration: true,
          emitDeclarationOnly: true,
          noEmit: false,
        };

        if (dirs.length === 1 && (this.isInTsConfig(dirs[0]) || parsedConfig.options.rootDir)) {
          const rootDir = parsedConfig.options.rootDir || dirs[0];
          const program = ts.createProgram(
            Array.isArray(this.config.entry) ? this.config.entry : [this.config.entry],
            {
              ...compilerOptions,
              rootDir,
              outDir: tmpDir,
            }
          );
          program.emit();
        } else {
          for (const dir of dirs) {
            const dirTmpPath = path.join(tmpDir, path.basename(dir));
            const program = ts.createProgram(
              entryDirs[dir],
              {
                ...compilerOptions,
                rootDir: dir,
                outDir: dirTmpPath,
              }
            );
            program.emit();
          }
        }

        const entries = Array.isArray(this.config.entry)
          ? this.config.entry
          : [this.config.entry];

        for (const entry of entries) {
          const entryName = path.parse(entry).name;
          const finalOutputDir = this.config.outfile
            ? path.dirname(this.config.outfile)
            : this.config.outputFolder!;
          const outputFile = path.join(finalOutputDir, `${entryName}.d.ts`).replace(/\\/g, '/');

          await dtsBundler.bundleTypes(tmpDir, outputFile, entry);
        }

        if (fs.existsSync(tmpDir)) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      } else {
        const tsConfigPath = path.join(process.cwd(), "tsconfig.json");
        const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
        const parsedConfig = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          path.dirname(tsConfigPath)
        );

        const program = ts.createProgram(
          Array.isArray(this.config.entry) ? this.config.entry : [this.config.entry],
          {
            ...parsedConfig.options,
            declaration: true,
            emitDeclarationOnly: true,
            noEmit: false,
            outDir: this.config.outputFolder,
          }
        );
        program.emit();
      }
    } catch (error) {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
      throw error;
    }
  }

  async build() {
    const entries = Array.isArray(this.config.entry)
      ? this.config.entry
      : [this.config.entry];

    const formats: ("esm" | "cjs")[] =
      this.config.format === "both"
        ? ["esm", "cjs"]
        : [this.config.format || "cjs"];

    for (const entry of entries) {
      for (const format of formats) {
        await this.buildWithEsbuild(entry, format);
      }
    }

    if (this.config.outputType) {
      await this.buildTypes();
    }
  }
}
