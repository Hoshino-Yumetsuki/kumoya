import { loadConfig } from "./modules/config";
import { Builder } from "./modules/build";
import { logger, BuildError } from "./modules/logger";

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    logger.info("");
    return;
  }

  if (args[0] === "build") {
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
    logger.error(`Unknown command: ${args[0]}`);
    process.exit(1);
  }
}

main();
