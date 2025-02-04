import path from "path";
import { execSync } from "child_process";
import { logger } from "../utils/logger";
import { Workspace } from "../utils/workspace";

export class Publisher {
  static async publishWorkspace(
    workspacePath: string,
    workspace: Workspace,
    npmCommand: string
  ) {
    if (!workspace.isWorkspace(workspacePath)) {
      const directWorkspaces = workspace.getWorkspaces("/" + workspacePath);
      logger.info(`Publishing all workspaces under ./${workspacePath}...`);

      for (const directWorkspace of directWorkspaces) {
        if (workspace.isWorkspace(directWorkspace)) {
          const publishPath = path.join(process.cwd(), directWorkspace);
          logger.info(
            `Publishing workspace: ./${directWorkspace} with command: ${npmCommand}`,
          );

          try {
            execSync(npmCommand, {
              cwd: publishPath,
              stdio: "inherit",
            });
            logger.success(
              `Successfully published workspace: ./${directWorkspace}`,
            );
          } catch (error) {
            logger.error(
              `Failed to publish workspace ./${directWorkspace}: ${error.message}`,
            );
          }
        }
      }
    } else {
      const publishPath = path.join(process.cwd(), workspacePath);
      logger.info(
        `Publishing workspace: ./${workspacePath} with command: ${npmCommand}`,
      );

      try {
        execSync(npmCommand, {
          cwd: publishPath,
          stdio: "inherit",
        });
        logger.success(
          `Successfully published workspace: ./${workspacePath}`,
        );
      } catch (error) {
        throw new Error(`Failed to publish workspace: ${error.message}`);
      }
    }
  }

  static async publishAll(workspaceName: string, npmArgs: string[], workspace: Workspace) {
    if (!workspaceName) {
      throw new Error("Workspace name is required for publish command");
    }

    const npmCommand = ["npm", "publish", ...npmArgs].join(" ");
    const workspacePaths = workspace.getWorkspacePath(workspaceName);
    logger.info(`Found ${workspacePaths.length} matching workspaces`);

    for (const workspacePath of workspacePaths) {
      await Publisher.publishWorkspace(workspacePath, workspace, npmCommand);
    }
  }
} 