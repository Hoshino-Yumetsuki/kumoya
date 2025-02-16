import fs from "fs";
import path from "path";
import { globby } from "globby";
import { logger } from "./logger";

export interface PackageJson {
  name: string;
  workspaces?: string[];
  [key: string]: any;
}

export class Workspace {
  private workspaces: Record<string, PackageJson> = {};
  private workspacePatterns: string[] = [];
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

    this.workspacePatterns = Array.isArray(rootPkg.workspaces)
      ? rootPkg.workspaces
      : rootPkg.workspaces.packages || [];

    await this.collectWorkspaces();
  }

  private async collectWorkspaces() {
    const patterns = this.workspacePatterns.map((pattern) =>
      pattern.replace(/\/?$/, "/package.json"),
    );

    logger.debug(`Using workspace patterns: ${JSON.stringify(patterns)}`);

    const files = await globby(patterns, {
      cwd: this.cwd,
      onlyFiles: true,
    });

    for (const file of files) {
      const dir = path.dirname(file);
      try {
        const pkg = JSON.parse(
          await fs.promises.readFile(path.join(this.cwd, file), "utf8"),
        );
        pkg.relativePath = dir;
        this.workspaces["/" + dir] = pkg;
        logger.debug(`Found workspace "${pkg.name}" at ${dir}`);
      } catch (error) {
        logger.warn(`Failed to read package.json at ${dir}: ${error.message}`);
      }
    }
  }

  async hasNestedWorkspaces(workspacePath: string): Promise<boolean> {
    const fullPath = path.join(this.cwd, workspacePath);

    try {
      const pkg = JSON.parse(
        await fs.promises.readFile(path.join(fullPath, "package.json"), "utf8"),
      );

      if (pkg.workspaces) {
        const patterns = Array.isArray(pkg.workspaces)
          ? pkg.workspaces
          : pkg.workspaces.packages || [];

        const nestedPatterns = patterns.map((pattern) =>
          path.join(workspacePath, pattern, "package.json"),
        );

        const files = await globby(nestedPatterns, {
          cwd: this.cwd,
          onlyFiles: true,
        });

        return files.length > 0;
      }
    } catch (error) {}

    const potentialNestedPatterns = this.workspacePatterns
      .filter((pattern) => {
        const segments = pattern.split("/");
        return segments.length > 2;
      })
      .map((pattern) =>
        path.join(
          workspacePath,
          pattern.split("/").slice(1).join("/"),
          "package.json",
        ),
      );

    const files = await globby(potentialNestedPatterns, {
      cwd: this.cwd,
      onlyFiles: true,
    });

    return files.length > 0;
  }

  async getDirectWorkspaces(basePath: string = ""): Promise<string[]> {
    const normalizedBasePath = basePath.startsWith("/")
      ? basePath
      : "/" + basePath;

    return Object.entries(this.workspaces)
      .filter(([folder, _]) => {
        if (!normalizedBasePath) return !folder.slice(1).includes("/");

        const relativePath = folder.slice(1);
        if (!relativePath.startsWith(basePath)) return false;

        const remainingPath = relativePath.slice(basePath.length);
        return (
          remainingPath.startsWith("/") && !remainingPath.slice(1).includes("/")
        );
      })
      .map(([_, pkg]) => pkg.relativePath);
  }

  isWorkspace(path: string): boolean {
    if (Object.keys(this.workspaces).length === 1 && this.workspaces[""]) {
      return path === "" || path === "/";
    }

    return Object.values(this.workspaces).some(
      (pkg) => pkg.relativePath === path || "/" + pkg.relativePath === path,
    );
  }

  getWorkspaces(basePath: string = ""): string[] {
    logger.debug(`Getting all workspaces under: ${basePath}`);

    if (Object.keys(this.workspaces).length === 1 && this.workspaces[""]) {
      return [];
    }

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

    if (Object.keys(this.workspaces).length === 1 && this.workspaces[""]) {
      if (name === "." || name === "") {
        return [""];
      }
      throw new Error(
        `Not a workspace project. Cannot find workspace "${name}"`,
      );
    }

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

  isSingleWorkspace(): boolean {
    return (
      Object.keys(this.workspaces).length === 1 &&
      this.workspaces[""] &&
      !this.workspaces[""].workspaces
    );
  }
}
