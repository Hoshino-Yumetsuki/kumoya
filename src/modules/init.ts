import fs from "fs";
import path from "path";
import { KumoyaConfig } from "../types";
import { logger } from "../utils/logger";
import { loadConfig } from "../utils/config";

export const defaultConfig = `export const kumoyaConfig = {
  entry: './src/index.ts',
  outputFolder: 'dist',
  bundle: true,
  outputType: true,
  minify: true,
  platform: 'node',
  packages: 'external',
};
`;

export const validKumoyaOptions = new Set([
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
  "extension",
]);

export function validateKumoyaConfig(config: any): KumoyaConfig {
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

export function initializeConfig(configPath: string): boolean {
  const fullPath = path.resolve(process.cwd(), configPath);

  if (!fs.existsSync(fullPath)) {
    logger.info("Config file not found, creating default configuration...");
    try {
      fs.writeFileSync(fullPath, defaultConfig, "utf-8");
      logger.success(`Default config file created: ${configPath}`);
      return true;
    } catch (error) {
      throw new Error(`Failed to create config file: ${error.message}`);
    }
  }
  return false;
}

export class Initializer {
  static async initialize() {
    try {
      const configExists = await loadConfig().catch(() => false);
      if (!configExists) {
        await loadConfig("init");
        logger.info("Initialization completed");
      } else {
        logger.info("");
      }
    } catch (error) {
      logger.error(error);
      process.exit(1);
    }
  }
}
