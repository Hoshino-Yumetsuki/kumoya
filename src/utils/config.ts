import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { BuilderOptions } from "../types";
import { BuildError, logger } from "./logger";
import { validateKumoyaConfig, initializeConfig } from "../modules/init";

async function validateEntry(
  entry: string | string[],
  basePath: string,
): Promise<boolean> {
  const entries = Array.isArray(entry) ? entry : [entry];

  for (const entryPath of entries) {
    const fullPath = path.resolve(basePath, entryPath);
    try {
      await fs.promises.access(fullPath);
    } catch (error) {
      logger.debug(`Entry point not found: ${fullPath}`);
      return false;
    }
  }
  return true;
}

export async function loadConfig(
  configPath: string = "kumoya.config.mjs",
  workspacePath?: string,
): Promise<BuilderOptions> {
  const basePath = workspacePath
    ? path.join(process.cwd(), workspacePath)
    : process.cwd();
  const fullPath = path.resolve(basePath, configPath);

  const isNewConfig = initializeConfig(configPath);
  if (isNewConfig) {
    process.exit(0);
  }

  try {
    const configUrl = pathToFileURL(fullPath).href;
    let config: BuilderOptions;

    try {
      config = await import(configUrl);
    } catch (error) {
      if (!workspacePath) {
        throw error;
      }
      const rootConfigPath = path.resolve(process.cwd(), configPath);
      const rootConfigUrl = pathToFileURL(rootConfigPath).href;
      config = await import(rootConfigUrl);

      if (config.kumoyaConfig?.entry) {
        const entries = Array.isArray(config.kumoyaConfig.entry)
          ? config.kumoyaConfig.entry
          : [config.kumoyaConfig.entry];

        config.kumoyaConfig.entry = entries.map((entry) => {
          if (entry.startsWith("./") || entry.startsWith("../")) {
            return entry;
          }
          const absolutePath = path.resolve(process.cwd(), entry);
          return path.relative(basePath, absolutePath);
        });
      }
    }

    if (!config.kumoyaConfig) {
      throw new BuildError("kumoyaConfig is required in config file");
    }

    if (!config.kumoyaConfig.entry) {
      throw new BuildError(
        "No entry point specified in kumoyaConfig. Please add an 'entry' field to your configuration.",
      );
    }

    const isEntryValid = await validateEntry(
      config.kumoyaConfig.entry,
      basePath,
    );
    if (!isEntryValid) {
      const entries = Array.isArray(config.kumoyaConfig.entry)
        ? config.kumoyaConfig.entry
        : [config.kumoyaConfig.entry];

      throw new BuildError(
        `Could not find entry point(s):\n${entries.map((e) => `  - ${e}`).join("\n")}\n` +
          `Please check your configuration and ensure the entry paths are correct relative to: ${basePath}`,
      );
    }

    return {
      kumoyaConfig: validateKumoyaConfig(config.kumoyaConfig),
      esbuildConfig: config.esbuildConfig,
      root: workspacePath,
    };
  } catch (error) {
    if (error instanceof BuildError) {
      throw error;
    }
    throw new BuildError(`Failed to load config file: ${error.message}`);
  }
}
