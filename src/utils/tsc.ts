import ts from "typescript";
import path from "path";
import fs from "fs";
import { logger } from "./logger";
import { rollup } from "rollup";
import multiEntry from "@rollup/plugin-multi-entry";
import dts from "rollup-plugin-dts";

export class DtsBundler {
  private tempDir: string;

  constructor() {
    this.tempDir = path.join(process.cwd(), ".kumoyatmp");
    fs.mkdirSync(this.tempDir, { recursive: true });
  }

  public async bundleTypes(
    program: ts.Program,
    outputFile: string,
    entryPoint?: string,
  ): Promise<void> {
    const emitResult = program.emit(
      undefined,
      (fileName: string, data: string) => {
        if (fileName.endsWith(".d.ts")) {
          const relativePath = path.relative(process.cwd(), fileName);
          const tempFile = path.join(this.tempDir, relativePath);

          fs.mkdirSync(path.dirname(tempFile), { recursive: true });
          fs.writeFileSync(tempFile, data);
          logger.debug(`Generated declaration file: ${relativePath}`);
        }
      },
    );

    if (emitResult.diagnostics.length > 0) {
      throw new Error("Failed to generate declaration files");
    }

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
    return `./${relativePath}`;
  }
}
