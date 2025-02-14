import chalk from "chalk";

export class BuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuildError";
  }
}

const prefix = chalk.cyan("kumoya");
const isDebug = process.argv.includes("--debug");

export const logger = {
  debug: (message: string) => {
    if (isDebug) {
      console.log(`${prefix} ${message}`);
    }
  },
  info: (message: string) => {
    console.log(`${prefix} ${message}`);
  },
  error: (message: string | Error) => {
    if (message instanceof Error) {
      console.error(`${prefix} ${chalk.red("✖")} Build Error:`);
      console.error(`    ${message.message}`);
      if (message.stack) {
        console.error(
          chalk.gray(
            message.stack
              .split("\n")
              .slice(1)
              .map((line) => `    ${line.trim()}`)
              .join("\n"),
          ),
        );
      }
    } else {
      console.error(`${prefix} ${chalk.red("✖")} Build Error:`);
      console.error(`    ${message}`);
    }
  },
  success: (message: string) => {
    console.log(`${prefix} ${chalk.green("✓")} ${message}`);
  },
  warn: (message: string) => {
    console.log(`${prefix} ${chalk.yellow("⚠")} ${message}`);
  },
};
