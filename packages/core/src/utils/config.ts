import { BuilderOptions } from "../types";
import * as path from "path";
import { BuildError } from "./logger";
import { pathToFileURL } from "url";
import { validateKumoyaConfig, initializeConfig } from "../modules/init";

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
    // 先尝试从指定路径加载配置
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
        root: workspacePath,
      };
    } catch (error) {
      // 如果从指定路径加载失败，尝试从根目录加载
      if (workspacePath) {
        const rootConfigPath = path.resolve(process.cwd(), configPath);
        const rootConfigUrl = pathToFileURL(rootConfigPath).href;
        const config = await import(rootConfigUrl);

        if (!config.kumoyaConfig) {
          throw new BuildError("kumoyaConfig is required in config file");
        }

        if (!config.kumoyaConfig.entry) {
          throw new BuildError("entry is required in kumoyaConfig");
        }

        return {
          kumoyaConfig: validateKumoyaConfig(config.kumoyaConfig),
          esbuildConfig: config.esbuildConfig,
          root: workspacePath,
        };
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof BuildError) {
      throw error;
    }
    throw new BuildError(`Failed to load config file: ${error.message}`);
  }
}
