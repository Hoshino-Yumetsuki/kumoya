import { globby } from "globby";
import fs from "fs/promises";
import path from "path";
import { logger } from "./logger";

export interface PackageJson {
  name: string;
  workspaces?: string[];
  [key: string]: any;
}

export class Workspace {
  private workspaces: Record<string, PackageJson> = {};
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
    logger.info(`Workspace initialized with cwd: ${cwd}`);
  }

  async initialize() {
    logger.info(
      `Reading root package.json from: ${path.join(this.cwd, "package.json")}`,
    );
    const rootPkg = JSON.parse(
      await fs.readFile(path.join(this.cwd, "package.json"), "utf8"),
    );

    const workspacePatterns = rootPkg.workspaces || ["packages/*"];
    logger.info(
      `Using workspace patterns: ${JSON.stringify(workspacePatterns)}`,
    );

    const folders = await globby(workspacePatterns, {
      cwd: this.cwd,
      onlyDirectories: true,
      expandDirectories: false,
    });
    folders.unshift("");

    logger.info(`Found workspace folders: ${JSON.stringify(folders)}`);

    this.workspaces = Object.fromEntries(
      (
        await Promise.all(
          folders.map(async (folder) => {
            const pkgPath = folder ? "/" + folder : "";
            try {
              const fullPath = path.join(this.cwd, folder, "package.json");
              logger.info(`Reading package.json from: ${fullPath}`);
              const content = await fs.readFile(fullPath, "utf8");
              const pkg = JSON.parse(content);
              pkg.relativePath = folder;
              logger.info(`Found package "${pkg.name}" at ${folder}`);
              return [pkgPath, pkg] as [string, PackageJson];
            } catch (error) {
              logger.warn(
                `Failed to read package.json at ${folder}: ${error.message}`,
              );
              return null;
            }
          }),
        )
      ).filter(Boolean),
    );
  }

  getWorkspaces(basePath: string = ''): string[] {
    
    return Object.entries(this.workspaces)
      .filter(([folder, pkg]) => {
        if (!basePath) return folder !== '';
        return folder.startsWith(basePath) && folder !== basePath;
      })
      .map(([_, pkg]) => pkg.relativePath);
  }

  getWorkspacePath(name: string): string {
    logger.info(`Looking for workspace: ${name}`);
    logger.info(
      `Available workspaces: ${JSON.stringify(Object.values(this.workspaces).map((pkg) => pkg.name))}`,
    );

    const targets = Object.keys(this.workspaces).filter((folder) => {
      const pkg = this.workspaces[folder];
      return (
        pkg.name === name ||
        (pkg.relativePath && pkg.relativePath.split("/").pop() === name) ||
        (folder === "" && name === ".") ||
        (folder.startsWith("/" + name) && folder !== "/" + name)
      );
    });

    logger.info(`Found matching workspaces: ${JSON.stringify(targets)}`);

    if (!targets.length) {
      throw new Error(`Cannot find workspace "${name}"`);
    } else if (targets.length > 1) {
      throw new Error(`Ambiguous workspace "${name}": ${targets.join(", ")}`);
    }

    return this.workspaces[targets[0]].relativePath || "";
  }
}
