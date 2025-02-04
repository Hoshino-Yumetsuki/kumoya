import ts from "typescript";
import path from "path";
import { logger } from "./logger";
import { rollup } from "rollup";
import multiEntry from "@rollup/plugin-multi-entry";
import dts from "rollup-plugin-dts";
import fs from "fs";

export class DtsBundler {
  private tempDir: string;

  constructor() {
    // 在工作区创建临时目录
    this.tempDir = path.join(process.cwd(), ".kumoya-dts");
    fs.mkdirSync(this.tempDir, { recursive: true });
  }

  public async bundleTypes(
    program: ts.Program,
    outputFile: string,
    entryPoint?: string,
  ): Promise<void> {
    // 使用原始路径结构在临时目录中生成声明文件
    const emitResult = program.emit(
      undefined,
      (fileName: string, data: string) => {
        if (fileName.endsWith(".d.ts")) {
          // 保持原始路径结构
          const relativePath = path.relative(process.cwd(), fileName);
          const tempFile = path.join(this.tempDir, relativePath);

          // 确保目标目录存在
          fs.mkdirSync(path.dirname(tempFile), { recursive: true });
          fs.writeFileSync(tempFile, data);
          logger.debug(`Generated declaration file: ${relativePath}`);
        }
      },
    );

    if (emitResult.diagnostics.length > 0) {
      throw new Error("Failed to generate declaration files");
    }

    // 获取所有生成的声明文件
    const declarationFiles = this.getAllFiles(this.tempDir).filter((file) =>
      file.endsWith(".d.ts"),
    );

    if (declarationFiles.length === 0) {
      throw new Error("No declaration files were generated");
    }

    logger.debug(`Found declaration files: ${declarationFiles.join(", ")}`);

    const bundle = await rollup({
      input: declarationFiles,
      plugins: [multiEntry(), dts()],
    });

    await bundle.write({
      file: outputFile,
      format: "es",
      sourcemap: false,
    });

    await bundle.close();

    if (entryPoint) {
      logger.info(
        `${this.normalizePath(entryPoint)} ==> ${this.normalizePath(outputFile)}`,
      );
    } else {
      logger.info(
        `${declarationFiles.map((f) => this.normalizePath(f)).join(", ")} ==> ${this.normalizePath(outputFile)}`,
      );
    }

    // 清理临时目录
    fs.rmSync(this.tempDir, { recursive: true, force: true });
  }

  private getAllFiles(dir: string): string[] {
    const files: string[] = [];
    const entries = fs.readdirSync(dir);

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        files.push(...this.getAllFiles(fullPath));
      } else {
        files.push(fullPath);
      }
    }

    return files;
  }

  private normalizePath(p: string): string {
    const relativePath = path.relative(process.cwd(), p).replace(/\\/g, "/");
    return relativePath;
  }
}
