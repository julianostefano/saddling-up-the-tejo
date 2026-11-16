#!/usr/bin/env bun
import { parseCliArgs, runCli } from "./cli.ts";
import { runTui } from "./tui.ts";

async function main(): Promise<void> {
  const argv = Bun.argv.slice(2);

  let wantsTui = false;
  let parsedArgs: ReturnType<typeof parseCliArgs> | undefined;
  try {
    parsedArgs = parseCliArgs(argv);
    wantsTui =
      parsedArgs.tui ||
      (argv.length === 0 && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY));
  } catch {
    // Let runCli print the exact argument parsing error and exit 1
    wantsTui = false;
  }

  const exitCode = wantsTui ? await runTui(parsedArgs) : await runCli(argv);
  process.exitCode = exitCode;
}

await main();
