import path from "path";
import { execSync } from "child_process";
import { logger } from "../utils/logger";
import { Workspace } from "../utils/workspace";

export class Publisher {
  static async publishWorkspace(
    workspacePath: string,
    workspace: Workspace,
    npmCommand: string,
  ) {
    if (!workspace.isWorkspace(workspacePath)) {
      if (workspace.isSingleWorkspace()) {
        const publishPath = path.join(process.cwd(), workspacePath);
        logger.info(`Publishing package: ./${workspacePath}`);

        try {
          execSync(npmCommand, {
            cwd: publishPath,
            stdio: "inherit",
          });
          logger.success(`Successfully published package: ./${workspacePath}`);
          return;
        } catch (error) {
          throw new Error(`Failed to publish package: ${error.message}`);
        }
      }

      const directWorkspaces = workspace.getWorkspaces("/" + workspacePath);
      logger.info(`Publishing all packages under ./${workspacePath}...`);

      for (const directWorkspace of directWorkspaces) {
        if (workspace.isWorkspace(directWorkspace)) {
          const publishPath = path.join(process.cwd(), directWorkspace);
          logger.info(`Publishing package: ./${directWorkspace}`);

          try {
            execSync(npmCommand, {
              cwd: publishPath,
              stdio: "inherit",
            });
            logger.success(
              `Successfully published package: ./${directWorkspace}`,
            );
          } catch (error) {
            logger.error(
              `Failed to publish package: ./${directWorkspace}: ${error.message}`,
            );
          }
        }
      }
    } else {
      const publishPath = path.join(process.cwd(), workspacePath);
      logger.info(`Publishing package: ./${workspacePath}`);

      try {
        execSync(npmCommand, {
          cwd: publishPath,
          stdio: "inherit",
        });
        logger.success(`Successfully published package: ./${workspacePath}`);
      } catch (error) {
        throw new Error(`Failed to publish package: ${error.message}`);
      }
    }
  }

  static async publishAll(
    workspaceName: string | undefined,
    npmArgs: string[],
    workspace: Workspace,
  ) {
    const npmCommand = ["yarn", "npm", "publish", ...npmArgs].join(" ");

    if (!workspaceName && workspace.isSingleWorkspace()) {
      logger.info(`Publishing package...`);
      try {
        execSync(npmCommand, {
          cwd: process.cwd(),
          stdio: "inherit",
        });
        logger.success("Successfully published package");
        return;
      } catch (error) {
        throw new Error(`Failed to publish package: ${error.message}`);
      }
    }

    if (!workspaceName) {
      throw new Error(
        "Workspace name is required for publishing in a multi-workspace project",
      );
    }

    const workspacePaths = workspace.getWorkspacePath(workspaceName);
    logger.debug(`Found ${workspacePaths.length} matching workspaces`);

    for (const workspacePath of workspacePaths) {
      await Publisher.publishWorkspace(workspacePath, workspace, npmCommand);
    }
  }
}
