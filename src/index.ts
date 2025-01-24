#!/usr/bin/env node
import { loadConfig } from "./config-loader";
import { Builder } from "./builder";
import { logger, BuildError } from "./logger";

async function main() {
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
}

main();

export { Builder } from "./builder";
export { loadConfig } from "./config-loader";
export type { BuilderOptions, KumoyaConfig } from "./types";
