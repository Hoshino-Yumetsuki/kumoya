export interface KumoyaConfig {
  entry: string | string[];
  outputFolder?: string;
  outfile?: string;
  bundle?: boolean;
  outputType?: boolean;
  format?: "esm" | "cjs" | "both";
  extension?: "js" | "mjs" | "cjs";
  platform?: "node" | "browser" | "neutral";
  minify?: boolean;
  packages?: "external";
  external?: string[];
  target?: string | string[];
  sourcemap?: boolean | "inline" | "external" | "both";
  treeShaking?: boolean;
  logLevel?: "info" | "warning" | "error" | "debug" | "silent";
}

export interface BuilderOptions {
  kumoyaConfig?: KumoyaConfig;
  esbuildConfig?: any;
  rollupConfig?: any;
  root?: string;
}
