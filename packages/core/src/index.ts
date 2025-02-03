import { loadConfig } from "./utils/config";
import { Builder } from "./modules/build";
import { logger, BuildError } from "./utils/logger";
import { Workspace } from "./utils/workspace";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const workspaceName = args[1];

  // 初始化 Workspace
  const workspace = new Workspace(process.cwd());
  await workspace.initialize();

  // 无参数或 init 命令时执行初始化
  if (!command || command === "init") {
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
    return;
  }

  if (command === "build") {
    try {
      const workspacePath = workspaceName
        ? workspace.getWorkspacePath(workspaceName)
        : undefined;
      const config = await loadConfig("kumoya.config.mjs", workspacePath);

      if (workspaceName) {
        logger.info(`Building workspace ${workspaceName}...`);
        const builder = new Builder(config);
        await builder.build();
      } else {
        logger.info("Building root workspace...");
        const builder = new Builder(config);
        await builder.build();
      }

      logger.success("Build completed!");
    } catch (error) {
      if (error instanceof BuildError) {
        logger.error(error);
      } else {
        logger.error(error);
      }
      process.exit(1);
    }
  } else {
    logger.error(`Unknown command: ${command}`);
    process.exit(1);
  }
}

main();
