import { globby } from "globby";
import * as fs from "fs";
import * as path from "path";
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
    logger.debug(`Workspace initialized with cwd: ${cwd}`);
  }

  async initialize() {
    logger.debug(
      `Reading root package.json from: ${path.join(this.cwd, "package.json")}`,
    );
    const rootPkg = JSON.parse(
      await fs.promises.readFile(path.join(this.cwd, "package.json"), "utf8"),
    );

    if (!rootPkg.workspaces) {
      logger.debug("No workspaces defined, treating as single workspace");
      rootPkg.relativePath = "";
      this.workspaces = { "": rootPkg };
      return;
    }

    const workspacePatterns = rootPkg.workspaces.map((pattern) =>
      pattern.replace(/\/?$/, "/**/package.json"),
    );

    logger.debug(
      `Using workspace patterns: ${JSON.stringify(workspacePatterns)}`,
    );

    const files = await globby(workspacePatterns, {
      cwd: this.cwd,
      onlyFiles: true,
    });

    const folders = files.map((file) => path.dirname(file));
    folders.unshift("");

    logger.debug(`Found workspace folders: ${JSON.stringify(folders)}`);

    this.workspaces = Object.fromEntries(
      (
        await Promise.all(
          folders.map(async (folder) => {
            const pkgPath = folder ? "/" + folder : "";
            try {
              const fullPath = path.join(this.cwd, folder, "package.json");
              logger.debug(`Reading package.json from: ${fullPath}`);
              const content = await fs.promises.readFile(fullPath, "utf8");
              const pkg = JSON.parse(content);
              pkg.relativePath = folder;
              logger.debug(`Found package "${pkg.name}" at ${folder}`);
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

  isWorkspace(path: string): boolean {
    return Object.values(this.workspaces).some(
      (pkg) => pkg.relativePath === path || "/" + pkg.relativePath === path,
    );
  }

  getWorkspaces(basePath: string = ""): string[] {
    logger.debug(`Getting all workspaces under: ${basePath}`);

    if (basePath && !this.isWorkspace(basePath)) {
      return Object.entries(this.workspaces)
        .filter(([folder]) => {
          const relativePath = folder.slice(1);
          return relativePath.startsWith(basePath.slice(1));
        })
        .map(([_, pkg]) => pkg.relativePath);
    }

    return Object.entries(this.workspaces)
      .filter(([folder]) => {
        if (!basePath) return folder !== "";

        const relativePath = folder.slice(1);
        const baseDir = basePath.slice(1);

        if (!relativePath.startsWith(baseDir)) return false;

        const remainingPath = relativePath.slice(baseDir.length);
        return (
          remainingPath.startsWith("/") && !remainingPath.slice(1).includes("/")
        );
      })
      .map(([_, pkg]) => pkg.relativePath);
  }

  getWorkspacePath(name: string): string[] {
    logger.debug(`Looking for workspace: ${name}`);
    logger.debug(
      `Available workspaces: ${JSON.stringify(Object.values(this.workspaces).map((pkg) => pkg.name))}`,
    );

    const targets = Object.keys(this.workspaces).filter((folder) => {
      const pkg = this.workspaces[folder];
      const folderName = pkg.relativePath?.split("/").pop();

      return (
        pkg.name === name ||
        (folder === "" && name === ".") ||
        folderName === name ||
        folder === "/" + name
      );
    });

    logger.debug(`Found matching workspaces: ${JSON.stringify(targets)}`);

    if (targets.length) {
      return targets.map(
        (target) => this.workspaces[target].relativePath || "",
      );
    }

    try {
      const fullPath = path.join(process.cwd(), name);
      const stats = fs.statSync(fullPath);
      if (stats.isDirectory()) {
        return [name];
      }
    } catch (error) {}

    throw new Error(`Cannot find workspace or directory "${name}"`);
  }
}
