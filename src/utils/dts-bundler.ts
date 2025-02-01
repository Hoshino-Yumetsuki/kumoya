import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import { logger } from "./logger";

interface DtsModule {
  content: string;
  imports: Set<string>;
  exports: Set<string>;
  references: string[];
}

export class DtsBundler {
  private parseDtsContent(filePath: string): DtsModule {
    const content = fs.readFileSync(filePath, "utf-8");
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
    );

    const imports = new Set<string>();
    const exports = new Set<string>();
    const references = [];

    // 解析三斜线引用指令
    const tripleSlashRefs = sourceFile.referencedFiles.map(
      (ref) => ref.fileName,
    );
    references.push(...tripleSlashRefs);

    // 遍历 AST
    function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = node.moduleSpecifier
          .getText()
          .replace(/['"]/g, "");
        imports.add(moduleSpecifier);
      } else if (ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier) {
          const moduleSpecifier = node.moduleSpecifier
            .getText()
            .replace(/['"]/g, "");
          exports.add(moduleSpecifier);
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

  public async bundleTypes(tmpDir: string, outputFile: string): Promise<void> {
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
    readDtsFiles(tmpDir);

    // 解析所有声明文件
    const modules = new Map<string, DtsModule>();
    for (const file of declarationFiles) {
      modules.set(file, this.parseDtsContent(file));
    }

    // 构建依赖图并排序
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

    // 拓扑排序
    const visited = new Set<string>();
    const sorted: string[] = [];

    function visit(file: string) {
      if (visited.has(file)) return;
      visited.add(file);
      const dependencies = graph.get(file) || new Set();
      for (const dep of dependencies) {
        visit(dep);
      }
      sorted.push(file);
    }

    declarationFiles.forEach((file) => visit(file));

    // 合并声明文件
    const seenExports = new Set<string>();
    let mergedContent = "";

    for (const file of sorted) {
      const module = modules.get(file)!;
      const lines = module.content.split("\n");

      // 过滤重复的导出
      const filteredLines = lines.filter((line) => {
        if (line.trim().startsWith("export")) {
          const exportName = line.match(
            /export\s+(?:type|interface|class|enum|const|function)?\s+(\w+)/,
          )?.[1];
          if (exportName) {
            if (seenExports.has(exportName)) {
              return false;
            }
            seenExports.add(exportName);
          }
        }
        return true;
      });

      mergedContent += filteredLines.join("\n") + "\n";
    }

    // 写入合并后的声明文件
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, mergedContent);

    logger.info(`Generated bundled declaration file: ${outputFile}`);
  }
}
