import { $ } from "bun";
import { resolve, basename, dirname } from "node:path";
import { statSync } from "node:fs";

export interface ShellPathInspection {
  exists: boolean;
  isFile: boolean;
  isDirectory: boolean;
  absolutePath: string;
  dirName: string;
  fileName: string;
  sizeBytes: number;
  shellListingLine: string;
}

export interface DirectoryEntry {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  sizeBytes: number;
}

/**
 * Inspects a local filesystem path using Bun's native `$` shell API (`dirname`, `basename`, `ls -l`)
 * combined with `Bun.file` metadata. All interpolated paths are safely escaped by Bun Shell.
 */
export async function inspectLocalPathWithShell(inputPath: string): Promise<ShellPathInspection> {
  const absolutePath = resolve(inputPath);

  // Use Bun Shell builtins (`dirname`, `basename`, `ls -l`) cross-platform
  const [shellDir, shellBase, lsResult] = await Promise.all([
    $`dirname ${absolutePath}`.nothrow().text(),
    $`basename ${absolutePath}`.nothrow().text(),
    $`ls -l ${absolutePath}`.nothrow().quiet(),
  ]);

  const dirName = shellDir.trim() || dirname(absolutePath);
  const fileName = shellBase.trim() || basename(absolutePath);
  const shellListingLine = lsResult.exitCode === 0 ? lsResult.stdout.toString().trim() : "";

  try {
    const st = statSync(absolutePath);
    const bunFile = Bun.file(absolutePath);
    return {
      exists: true,
      isFile: st.isFile(),
      isDirectory: st.isDirectory(),
      absolutePath,
      dirName,
      fileName,
      sizeBytes: st.isFile() ? bunFile.size : 0,
      shellListingLine,
    };
  } catch {
    return {
      exists: false,
      isFile: false,
      isDirectory: false,
      absolutePath,
      dirName,
      fileName,
      sizeBytes: 0,
      shellListingLine,
    };
  }
}

/**
 * Lists files and directories in `dirPath` using Bun Shell `ls -l` for interactive TUI browsing.
 */
export async function listDirectoryEntriesWithShell(dirPath: string): Promise<DirectoryEntry[]> {
  const absDir = resolve(dirPath);
  const result = await $`ls -l ${absDir}`.nothrow().quiet();
  if (result.exitCode !== 0) {
    return [];
  }

  const lines = result.stdout
    .toString()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("total "));

  const entries: DirectoryEntry[] = [];
  for (const line of lines) {
    // Typical `ls -l` output from Bun Shell:
    // drw-rw-rw-   1     0     0        0 Nov 16 13:40 folder name
    const match = /^([d\-l]\S*)\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+\S+\s+(.+)$/.exec(line);
    if (!match) continue;
    const perms = match[1] ?? "";
    const sizeRaw = match[2] ?? "0";
    const name = match[3] ?? "";
    if (!name || name === "." || name === "..") continue;
    const fullPath = resolve(absDir, name);
    const isDir = perms.startsWith("d");
    const sizeBytes = isDir ? 0 : Number(sizeRaw) || 0;
    entries.push({
      name,
      fullPath,
      isDirectory: isDir,
      sizeBytes,
    });
  }

  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return entries;
}

/**
 * Runs `bun check` via Bun Shell with `AGENT=1` for AI-agent-friendly diagnostics.
 */
export async function runTypeCheckWithShell(projectRoot: string): Promise<{
  exitCode: number;
  output: string;
}> {
  const res = await $`bun check --no-script`
    .cwd(projectRoot)
    .env({ ...process.env, AGENT: "1" })
    .nothrow()
    .quiet();
  const output = [res.stdout.toString(), res.stderr.toString()].filter(Boolean).join("\n").trim();
  return { exitCode: res.exitCode, output };
}
