import { loadConfig } from "./modules/config";
import { Builder } from "./modules/build";
import { logger, BuildError } from "./modules/logger";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // 无参数或 init 命令时执行初始化
  if (!command || command === "init") {
    try {
      await loadConfig();
      logger.info("");
    } catch (error) {
      logger.error(error);
      process.exit(1);
    }
    return;
  }

  if (command === "build") {
    try {
      const config = await loadConfig();
      logger.info("Starting build process...");

      const builder = new Builder(config);
      await builder.build();

      logger.success("Done!");
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
