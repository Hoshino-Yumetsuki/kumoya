import { Builder } from "./modules/build";
import { logger, BuildError } from "./utils/logger";
import { Workspace } from "./utils/workspace";
import { Initializer } from "./modules/init";
import { Publisher } from "./modules/publish";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const workspaceName = args[1];

  const workspace = new Workspace(process.cwd());
  await workspace.initialize();

  if (!command || command === "init") {
    await Initializer.initialize();
    return;
  }

  if (command === "build") {
    try {
      await Builder.buildAll(workspaceName, workspace);
    } catch (error) {
      if (error instanceof BuildError) {
        logger.error(error);
      } else {
        logger.error(error);
      }
      process.exit(1);
    }
  } else if (command === "publish") {
    try {
      const npmArgs = args.slice(2);
      await Publisher.publishAll(workspaceName, npmArgs, workspace);
    } catch (error) {
      logger.error(error);
      process.exit(1);
    }
  } else {
    logger.error(`Unknown command: ${command}`);
    process.exit(1);
  }
}

main();
