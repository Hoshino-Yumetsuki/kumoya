import path from "path";
import fs from "fs";
import esbuild from "esbuild";
import ts from "typescript";
import { BuilderOptions, KumoyaConfig } from "../types";
import { BuildError, logger } from "../utils/logger";
import { DtsBundler } from "../utils/tsc";
import { Workspace } from "../utils/workspace";
import { loadConfig } from "../utils/config";

export class Builder {
  private config: KumoyaConfig;
  private esbuildConfig: any;
  private tsConfig: any;
  private workingDir: string;

  constructor(options: BuilderOptions) {
    this.workingDir = options.root
      ? path.join(process.cwd(), options.root)
      : process.cwd();
    this.config = {
      platform: "node",
      format: "cjs",
      ...options.kumoyaConfig,
    } as KumoyaConfig;

    if (this.config.entry) {
      const entries = Array.isArray(this.config.entry)
        ? this.config.entry
        : [this.config.entry];
      this.config.entry = entries.map((entry) =>
        path.join(this.workingDir, entry),
      );
    }

    if (this.config.outputFolder) {
      this.config.outputFolder = path.join(
        this.workingDir,
        this.config.outputFolder,
      );
    }
    if (this.config.outfile) {
      this.config.outfile = path.join(this.workingDir, this.config.outfile);
    }

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
      const tsConfigPath = path.join(this.workingDir, "tsconfig.json");
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

  private normalizePath(p: string): string {
    const relativePath = path.relative(process.cwd(), p).replace(/\\/g, "/");
    return `./${relativePath}`;
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
      );
    }

    if (this.config.packages && this.config.external) {
      throw new BuildError("Cannot use both 'packages' and 'external' options");
    }

    const buildOptions: any = {
      entryPoints: [entry],
      bundle: this.config.bundle,
      outfile: outputFile,
      platform: this.config.platform || "node",
      format,
      target: this.config.target || "es2015",
    };

    if (this.config.packages) {
      buildOptions.packages = this.config.packages;
    }

    if (this.config.external?.length) {
      buildOptions.external = this.config.external;
    }

    if (this.esbuildConfig?.external?.length) {
      buildOptions.external = this.esbuildConfig.external;
    }

    if (this.config.minify !== undefined)
      buildOptions.minify = this.config.minify;
    if (this.config.sourcemap !== undefined)
      buildOptions.sourcemap = this.config.sourcemap;
    if (this.config.treeShaking !== undefined)
      buildOptions.treeShaking = this.config.treeShaking;
    if (this.config.logLevel) buildOptions.logLevel = this.config.logLevel;

    logger.info(
      `${this.normalizePath(entry)} ==> ${this.normalizePath(outputFile)}`,
    );

    await esbuild.build({
      ...buildOptions,
      ...this.esbuildConfig,
    });
  }

  private async buildTypes() {
    const dtsBundler = new DtsBundler();

    if (this.config.bundle) {
      const tsConfigPath = path.join(process.cwd(), "tsconfig.json");
      const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
      const parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(tsConfigPath),
      );

      const compilerOptions: ts.CompilerOptions = {
        ...parsedConfig.options,
        declaration: true,
        emitDeclarationOnly: true,
        noEmit: false,
        outDir: this.config.outputFolder,
        declarationDir: this.config.outputFolder,
      };

      const entries = Array.isArray(this.config.entry)
        ? this.config.entry
        : [this.config.entry];

      for (const entry of entries) {
        const entryName = path.parse(entry).name;
        const finalOutputDir = this.config.outfile
          ? path.dirname(this.config.outfile)
          : this.config.outputFolder!;
        const outputFile = path
          .join(finalOutputDir, `${entryName}.d.ts`)
          .replace(/\\/g, "/");

        fs.mkdirSync(path.dirname(outputFile), { recursive: true });

        const program = ts.createProgram([entry], compilerOptions);
        await dtsBundler.bundleTypes(program, outputFile, entry);
      }
    } else {
      const tsConfigPath = path.join(process.cwd(), "tsconfig.json");
      const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
      const parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(tsConfigPath),
      );

      const compilerOptions: ts.CompilerOptions = {
        ...parsedConfig.options,
        declaration: true,
        emitDeclarationOnly: true,
        noEmit: false,
        outDir: this.config.outputFolder,
        declarationDir: this.config.outputFolder,
      };

      fs.mkdirSync(this.config.outputFolder!, { recursive: true });

      const program = ts.createProgram(
        Array.isArray(this.config.entry)
          ? this.config.entry
          : [this.config.entry],
        compilerOptions,
      );
      program.emit();
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

  static async buildWorkspace(workspacePath: string, workspace: Workspace) {
    if (!workspace.isWorkspace(workspacePath)) {
      const subWorkspaces = workspace.getWorkspaces("/" + workspacePath);
      logger.info(`Building all workspaces under ./${workspacePath}...`);

      const rootConfig = await loadConfig();

      for (const subWorkspace of subWorkspaces) {
        let subConfig = await loadConfig(
          "kumoya.config.mjs",
          subWorkspace,
        ).catch(() => null);

        if (!subConfig) {
          logger.debug(
            `No config found in ./${subWorkspace}, using root config`,
          );
          subConfig = rootConfig;
        } else {
          logger.debug(
            `Merging config from ./${subWorkspace} with root config`,
          );
          subConfig = {
            ...rootConfig,
            ...subConfig,
            kumoyaConfig: {
              ...rootConfig.kumoyaConfig,
              ...subConfig.kumoyaConfig,
            },
          };
        }

        logger.info(`Building workspace: ./${subWorkspace}...`);
        const subBuilder = new Builder({
          ...subConfig,
          root: subWorkspace,
        });
        await subBuilder.build();
      }
      return;
    }

    const rootConfig = await loadConfig();

    let config = await loadConfig("kumoya.config.mjs", workspacePath).catch(
      () => null,
    );

    if (!config) {
      logger.debug(`No config found in ./${workspacePath}, using root config`);
      config = rootConfig;
    } else {
      logger.debug(`Merging config from ./${workspacePath} with root config`);
      config = {
        ...rootConfig,
        ...config,
        kumoyaConfig: {
          ...rootConfig.kumoyaConfig,
          ...config.kumoyaConfig,
        },
      };
    }

    const subWorkspaces = workspace.getWorkspaces("/" + workspacePath);

    if (subWorkspaces.length > 0) {
      logger.info(
        `Building workspace ./${workspacePath} and its subworkspaces...`,
      );
      const builder = new Builder({
        ...config,
        root: workspacePath,
      });
      await builder.build();

      for (const subWorkspace of subWorkspaces) {
        let subConfig = await loadConfig(
          "kumoya.config.mjs",
          subWorkspace,
        ).catch(() => null);

        if (!subConfig) {
          logger.debug(
            `No config found in ./${subWorkspace}, using parent config`,
          );
          subConfig = config;
        } else {
          logger.debug(
            `Merging config from ./${subWorkspace} with parent config`,
          );
          subConfig = {
            ...config,
            ...subConfig,
            kumoyaConfig: {
              ...config.kumoyaConfig,
              ...subConfig.kumoyaConfig,
            },
          };
        }

        logger.info(`Building subworkspace: ./${subWorkspace}...`);
        const subBuilder = new Builder({
          ...subConfig,
          root: subWorkspace,
        });
        await subBuilder.build();
      }
    } else {
      logger.info(`Building workspace: ./${workspacePath}...`);
      const builder = new Builder({
        ...config,
        root: workspacePath,
      });
      await builder.build();
    }
  }

  static async buildAll(
    workspaceName: string | undefined,
    workspace: Workspace,
  ) {
    if (workspaceName) {
      const workspacePaths = workspace.getWorkspacePath(workspaceName);
      logger.debug(`Found ${workspacePaths.length} matching workspaces`);

      for (const workspacePath of workspacePaths) {
        await Builder.buildWorkspace(workspacePath, workspace);
      }
    } else {
      logger.debug("Building root workspace...");
      const config = await loadConfig();
      const builder = new Builder(config);
      await builder.build();
    }

    logger.success("Build completed!");
  }
}
