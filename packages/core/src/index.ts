import { loadConfig } from "./utils/config";
import { Builder } from "./modules/build";
import { logger, BuildError } from "./utils/logger";
import { Workspace } from "./utils/workspace";
import path from "path";
import { execSync } from "child_process";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const workspaceName = args[1];

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
      if (workspaceName) {
        const workspacePaths = workspace.getWorkspacePath(workspaceName);
        logger.info(`Found ${workspacePaths.length} matching workspaces`);

        for (const workspacePath of workspacePaths) {
          if (!workspace.isWorkspace(workspacePath)) {
            const subWorkspaces = workspace.getWorkspaces("/" + workspacePath);
            logger.info(`Building all workspaces under ${workspacePath}...`);

            for (const subWorkspace of subWorkspaces) {
              const subConfig = await loadConfig(
                "kumoya.config.mjs",
                subWorkspace,
              );
              logger.info(`Building workspace: ${subWorkspace}...`);
              const subBuilder = new Builder(subConfig);
              await subBuilder.build();
            }
            continue;
          }

          const config = await loadConfig("kumoya.config.mjs", workspacePath);
          const subWorkspaces = workspace.getWorkspaces("/" + workspacePath);

          if (subWorkspaces.length > 0) {
            logger.info(
              `Building workspace ${workspacePath} and its subworkspaces...`,
            );
            const builder = new Builder(config);
            await builder.build();

            for (const subWorkspace of subWorkspaces) {
              const subConfig = await loadConfig(
                "kumoya.config.mjs",
                subWorkspace,
              );
              logger.info(`Building subworkspace: ${subWorkspace}...`);
              const subBuilder = new Builder(subConfig);
              await subBuilder.build();
            }
          } else {
            logger.info(`Building workspace: ${workspacePath}...`);
            const builder = new Builder(config);
            await builder.build();
          }
        }
      } else {
        logger.info("Building root workspace...");
        const config = await loadConfig();
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
  } else if (command === "publish") {
    try {
      if (!workspaceName) {
        throw new Error("Workspace name is required for publish command");
      }

      const npmArgs = args.slice(2);
      const npmCommand = ["npm", "publish", ...npmArgs].join(" ");

      const workspacePaths = workspace.getWorkspacePath(workspaceName);
      logger.info(`Found ${workspacePaths.length} matching workspaces`);

      for (const workspacePath of workspacePaths) {
        if (!workspace.isWorkspace(workspacePath)) {
          const directWorkspaces = workspace.getWorkspaces("/" + workspacePath);
          logger.info(`Publishing all workspaces under ${workspacePath}...`);

          for (const directWorkspace of directWorkspaces) {
            if (workspace.isWorkspace(directWorkspace)) {
              const publishPath = path.join(process.cwd(), directWorkspace);
              logger.info(
                `Publishing workspace: ${directWorkspace} with command: ${npmCommand}`,
              );

              try {
                execSync(npmCommand, {
                  cwd: publishPath,
                  stdio: "inherit",
                });
                logger.success(
                  `Successfully published workspace: ${directWorkspace}`,
                );
              } catch (error) {
                logger.error(
                  `Failed to publish workspace ${directWorkspace}: ${error.message}`,
                );
              }
            }
          }
        } else {
          const publishPath = path.join(process.cwd(), workspacePath);
          logger.info(
            `Publishing workspace: ${workspacePath} with command: ${npmCommand}`,
          );

          try {
            execSync(npmCommand, {
              cwd: publishPath,
              stdio: "inherit",
            });
            logger.success(
              `Successfully published workspace: ${workspacePath}`,
            );
          } catch (error) {
            throw new Error(`Failed to publish workspace: ${error.message}`);
          }
        }
      }
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
