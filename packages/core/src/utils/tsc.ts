import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import { logger } from "./logger";

interface DtsModule {
  content: string;
  imports: Set<string>;
  exports: Map<string, ts.Node>;
  references: string[];
}

export class DtsBundler {
  private typeCache: Map<string, string> = new Map();

  private parseDtsContent(filePath: string): DtsModule {
    const content = fs.readFileSync(filePath, "utf-8");
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
    );

    const imports = new Set<string>();
    const exports = new Map<string, ts.Node>();
    const references = [];

    const tripleSlashRefs = sourceFile.referencedFiles.map(
      (ref) => ref.fileName,
    );
    references.push(...tripleSlashRefs);

    function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = node.moduleSpecifier
          .getText()
          .replace(/['"]/g, "");
        imports.add(moduleSpecifier);
      } else if (ts.isExportDeclaration(node)) {
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          node.exportClause.elements.forEach((element) => {
            exports.set(element.name.text, element);
          });
        }
      } else if (
        ts.isExportAssignment(node) ||
        ts.isExportDeclaration(node) ||
        ((ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isFunctionDeclaration(node) ||
          ts.isTypeAliasDeclaration(node)) &&
          node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
      ) {
        const name = (node as any).name?.text;
        if (name) {
          exports.set(name, node);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);

    return {
      content,
      imports,
      exports,
      references,
    };
  }

  private detectCycles(graph: Map<string, Set<string>>): Set<string>[] {
    const cycles: Set<string>[] = [];
    const visited = new Set<string>();
    const stack = new Set<string>();

    function dfs(node: string, path: string[]) {
      if (stack.has(node)) {
        const cycleStart = path.indexOf(node);
        cycles.push(new Set(path.slice(cycleStart)));
        return;
      }
      if (visited.has(node)) return;

      visited.add(node);
      stack.add(node);
      path.push(node);

      const neighbors = graph.get(node) || new Set();
      for (const neighbor of neighbors) {
        dfs(neighbor, [...path]);
      }

      stack.delete(node);
      path.pop();
    }

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        dfs(node, []);
      }
    }

    return cycles;
  }

  private async resolveImports(
    filePath: string,
    content: string,
    modules: Map<string, DtsModule>,
  ): Promise<string> {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
    );

    let result = content;
    const imports = new Set<string>();

    // 收集所有导入声明和它们的位置
    const importNodes: {
      node: ts.ImportDeclaration;
      moduleSpecifier: string;
    }[] = [];
    ts.forEachChild(sourceFile, (node) => {
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = node.moduleSpecifier
          .getText()
          .replace(/['"]/g, "");
        if (moduleSpecifier.startsWith(".")) {
          importNodes.push({ node, moduleSpecifier });
          imports.add(moduleSpecifier);
        }
      }
    });

    // 处理每个导入
    for (const { node, moduleSpecifier } of importNodes) {
      const resolvedPath = path.resolve(
        path.dirname(filePath),
        moduleSpecifier + ".d.ts",
      );
      const importedModule = modules.get(resolvedPath);

      if (importedModule) {
        const importClause = node.importClause;
        if (
          importClause?.namedBindings &&
          ts.isNamedImports(importClause.namedBindings)
        ) {
          const importedTypes = importClause.namedBindings.elements.map(
            (e) => e.name.text,
          );

          // 从导入模块中提取相应的类型声明并确保正确的格式
          const typeDeclarations = Array.from(importedModule.exports.entries())
            .filter(([name]) => importedTypes.includes(name))
            .map(([_, node]) => {
              const text = node.getText();
              // 确保导出声明从行首开始
              return text.replace(/^\s+/gm, "");
            })
            .join("\n");

          // 替换导入语句为实际的类型声明
          const importStatement = node.getText();
          result = result.replace(importStatement, typeDeclarations);
        }
      }
    }

    return result;
  }

  public async bundleTypes(
    outputFile: string,
    entryPoint?: string,
    workspacePath?: string,
  ): Promise<void> {
    const baseDir = workspacePath
      ? path.join(process.cwd(), workspacePath)
      : process.cwd();
    const tmpDirFull = path.resolve(baseDir, ".kumoyatmp");

    // 读取所有声明文件
    const declarationFiles: string[] = [];
    const readDtsFiles = (dir: string) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          readDtsFiles(fullPath);
        } else if (file.endsWith(".d.ts")) {
          declarationFiles.push(fullPath);
        }
      }
    };
    readDtsFiles(tmpDirFull);

    const modules = new Map<string, DtsModule>();
    for (const file of declarationFiles) {
      modules.set(file, this.parseDtsContent(file));
    }

    const graph = new Map<string, Set<string>>();
    modules.forEach((module, file) => {
      graph.set(file, new Set());
      module.imports.forEach((imp) => {
        const importedFile = declarationFiles.find((f) => f.includes(imp));
        if (importedFile) {
          graph.get(file)!.add(importedFile);
        }
      });
      module.references.forEach((ref) => {
        const referencedFile = declarationFiles.find((f) => f.includes(ref));
        if (referencedFile) {
          graph.get(file)!.add(referencedFile);
        }
      });
    });

    // 检测并处理循环依赖
    const cycles = this.detectCycles(graph);
    for (const cycle of cycles) {
      logger.warn(
        `Detected circular dependency in files: ${Array.from(cycle).join(" -> ")}`,
      );
      // 将循环依赖中的所有类型声明合并到一个文件中
      this.mergeCircularDependencies(cycle, modules);
    }

    // 修改拓扑排序的处理逻辑
    const sorted = this.topologicalSort(graph, cycles);

    const seenExports = new Set<string>();
    let mergedContent = "";

    for (const file of sorted) {
      const module = modules.get(file)!;
      const processedContent = await this.resolveImports(
        file,
        module.content,
        modules,
      );

      const sourceFile = ts.createSourceFile(
        file,
        processedContent,
        ts.ScriptTarget.Latest,
        true,
      );

      // 使用 AST 遍历来保持正确的结构
      function visit(node: ts.Node) {
        if (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) {
          const name = node.name?.text;
          if (name && !seenExports.has(name)) {
            seenExports.add(name);
            mergedContent += node.getText() + "\n\n";
          }
        } else if (
          ts.isTypeAliasDeclaration(node) ||
          ts.isFunctionDeclaration(node)
        ) {
          const name = node.name?.text;
          if (name && !seenExports.has(name)) {
            seenExports.add(name);
            mergedContent += node.getText() + "\n\n";
          }
        }

        ts.forEachChild(node, visit);
      }

      ts.forEachChild(sourceFile, visit);
    }

    mergedContent = mergedContent
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\s*([{};,])\s*/g, "$1")
      .replace(/\s+/g, " ")
      .replace(/\s+$/, "");

    if (entryPoint) {
      logger.info(
        `${path.posix.normalize(entryPoint)} ==> ${path.posix.normalize(outputFile)}`,
      );
    } else {
      logger.info(
        `${path.posix.normalize(tmpDirFull)} ==> ${path.posix.normalize(outputFile)}`,
      );
    }

    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, mergedContent);
  }

  private mergeCircularDependencies(
    cycle: Set<string>,
    modules: Map<string, DtsModule>,
  ) {
    // 将循环依赖中的所有类型声明合并到第一个文件中
    const [first, ...rest] = Array.from(cycle);
    const firstModule = modules.get(first)!;

    for (const file of rest) {
      const module = modules.get(file)!;
      // 合并导出
      module.exports.forEach((node, name) => {
        if (!firstModule.exports.has(name)) {
          firstModule.exports.set(name, node);
        }
      });
      // 合并导入
      module.imports.forEach((imp) => firstModule.imports.add(imp));
      // 移除其他文件的声明
      modules.delete(file);
    }
  }

  private topologicalSort(
    graph: Map<string, Set<string>>,
    _cycles: Set<string>[],
  ): string[] {
    const visited = new Set<string>();
    const result: string[] = [];

    function visit(node: string) {
      if (visited.has(node)) return;
      visited.add(node);
      for (const dep of graph.get(node) || []) {
        visit(dep);
      }
      result.push(node);
    }

    for (const node of graph.keys()) {
      visit(node);
    }

    return result.reverse();
  }
}
