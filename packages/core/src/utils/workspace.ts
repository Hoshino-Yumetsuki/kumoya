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

  isWorkspace(path: string): boolean {
    return Object.values(this.workspaces).some(pkg => 
      pkg.relativePath === path || 
      ('/' + pkg.relativePath) === path
    );
  }

  getWorkspaces(basePath: string = ''): string[] {
    logger.info(`Getting all workspaces under: ${basePath}`);
    
    // 如果basePath不是工作区，直接返回其下的所有子工作区
    if (basePath && !this.isWorkspace(basePath)) {
      return Object.entries(this.workspaces)
        .filter(([folder, pkg]) => {
          const relativePath = folder.slice(1); // 移除开头的 '/'
          return relativePath.startsWith(basePath.slice(1));
        })
        .map(([_, pkg]) => pkg.relativePath);
    }
    
    // 如果是工作区，只返回直接子工作区
    return Object.entries(this.workspaces)
      .filter(([folder, pkg]) => {
        if (!basePath) return folder !== '';
        
        const relativePath = folder.slice(1);
        const baseDir = basePath.slice(1);
        
        if (!relativePath.startsWith(baseDir)) return false;
        
        const remainingPath = relativePath.slice(baseDir.length);
        return remainingPath.startsWith('/') && !remainingPath.slice(1).includes('/');
      })
      .map(([_, pkg]) => pkg.relativePath);
  }

  getWorkspacePath(name: string): string[] {
    logger.info(`Looking for workspace: ${name}`);
    logger.info(
      `Available workspaces: ${JSON.stringify(Object.values(this.workspaces).map((pkg) => pkg.name))}`,
    );

    const targets = Object.keys(this.workspaces).filter((folder) => {
      const pkg = this.workspaces[folder];
      const folderName = pkg.relativePath?.split("/").pop();
      
      return (
        pkg.name === name ||
        (folder === "" && name === ".") ||
        (folderName === name) ||
        (folder === "/" + name)
      );
    });

    logger.info(`Found matching workspaces: ${JSON.stringify(targets)}`);

    if (!targets.length) {
      // 如果没找到工作区且名称是文件夹路径，直接返回该路径
      if (name.includes('/') || name === 'packages') {
        return [name];
      }
      throw new Error(`Cannot find workspace "${name}"`);
    }

    return targets.map(target => this.workspaces[target].relativePath || "");
  }
}
