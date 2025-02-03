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
      if (workspaceName) {
        try {
          const workspacePath = workspace.getWorkspacePath(workspaceName);
          const config = await loadConfig("kumoya.config.mjs", workspacePath);
          const subWorkspaces = workspace.getWorkspaces('/' + workspacePath);
          
          if (subWorkspaces.length > 0) {
            logger.info(`Building workspace ${workspaceName} and its subworkspaces...`);
            const builder = new Builder(config);
            await builder.build();
            
            for (const subWorkspace of subWorkspaces) {
              const subConfig = await loadConfig("kumoya.config.mjs", subWorkspace);
              logger.info(`Building subworkspace: ${subWorkspace}...`);
              const subBuilder = new Builder(subConfig);
              await subBuilder.build();
            }
          } else {
            logger.info(`Building workspace ${workspaceName}...`);
            const builder = new Builder(config);
            await builder.build();
          }
        } catch (error) {
          if (error.message.includes("Ambiguous workspace")) {
            // 处理多个匹配的情况
            const matches = error.message.match(/: (.+)$/)[1].split(", ");
            logger.info(`Building multiple matching workspaces...`);
            
            for (const match of matches) {
              const relativePath = match.substring(1); // 移除开头的 '/'
              const config = await loadConfig("kumoya.config.mjs", relativePath);
              logger.info(`Building workspace: ${relativePath}...`);
              const builder = new Builder(config);
              await builder.build();
            }
          } else {
            throw error;
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
  } else {
    logger.error(`Unknown command: ${command}`);
    process.exit(1);
  }
}

main();
