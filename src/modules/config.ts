import { BuilderOptions } from "../types";
import * as path from "path";
import { BuildError } from "./logger";
import { pathToFileURL } from "url";
import { validateKumoyaConfig, initializeConfig } from "./init";

export async function loadConfig(
  configPath: string = "kumoya.config.mjs",
): Promise<BuilderOptions> {
  const fullPath = path.resolve(process.cwd(), configPath);

  const isNewConfig = initializeConfig(configPath);
  if (isNewConfig) {
    process.exit(0);
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
    };
  } catch (error) {
    if (error instanceof BuildError) {
      throw error;
    }
    throw new BuildError(`Failed to load config file: ${error.message}`);
  }
}
