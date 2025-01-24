import { BuilderOptions, KumoyaConfig } from "./types";
import * as path from "path";
import * as fs from "fs";
import { logger, BuildError } from "./logger";
import { pathToFileURL } from "url";

const defaultConfig = `export const kumoyaConfig = {
  entry: './src/index.ts',
  outputFolder: 'dist',
  bundle: true,
  outputType: true,
  minify: true,
  platform: 'node',
  packages: 'external',
};
`;

const validKumoyaOptions = new Set([
  "entry",
  "outputFolder",
  "outfile",
  "bundle",
  "outputType",
  "format",
  "platform",
  "minify",
  "packages",
  "external",
  "target",
  "sourcemap",
  "treeShaking",
  "logLevel",
  "extension"
]);

function validateKumoyaConfig(config: any): KumoyaConfig {
  const validatedConfig: any = {};

  validatedConfig.platform = "node";
  validatedConfig.format = "cjs";

  for (const key in config) {
    if (validKumoyaOptions.has(key)) {
      validatedConfig[key] = config[key];
    } else {
      logger.warn(
        `Unknown kumoya config option: "${key}", this option will be ignored`,
      );
    }
  }

  const entries = Array.isArray(config.entry) ? config.entry : [config.entry];
  const hasJsFiles = entries.some((entry) => entry.endsWith(".js"));

  if (hasJsFiles && !config.platform && !config.format) {
    logger.warn(
      "Building .js files without specified 'platform' or 'format'. Using default: platform='node', format='cjs'",
    );
  }

  return validatedConfig;
}

export async function loadConfig(
  configPath: string = "kumoya.config.mjs",
): Promise<BuilderOptions> {
  const fullPath = path.resolve(process.cwd(), configPath);

  if (!fs.existsSync(fullPath)) {
    logger.info("Config file not found, creating default configuration...");
    try {
      fs.writeFileSync(fullPath, defaultConfig, "utf-8");
      logger.success(`Default config file created: ${configPath}`);
      process.exit(0);
    } catch (error) {
      throw new BuildError(`Failed to create config file: ${error.message}`);
    }
  }

  try {
    const configUrl = pathToFileURL(fullPath).href;
    const config = await import(configUrl);

    if (!config.kumoyaConfig) {
      throw new BuildError("kumoyaConfig is required in config file");
    }

    if (!config.kumoyaConfig.entry) {
      throw new BuildError("entry is required in kumoyaConfig");
    }

    return {
      kumoyaConfig: validateKumoyaConfig(config.kumoyaConfig),
      esbuildConfig: config.esbuildConfig,
      rollupConfig: config.rollupConfig,
    };
  } catch (error) {
    if (error instanceof BuildError) {
      throw error;
    }
    throw new BuildError(`Failed to load config file: ${error.message}`);
  }
}
