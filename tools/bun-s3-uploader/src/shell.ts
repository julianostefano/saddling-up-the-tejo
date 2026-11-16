import { $, Glob } from "bun";
import { resolve, basename, dirname } from "node:path";
import { statSync } from "node:fs";
import type { ResolvedUploadTarget } from "./types.ts";

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

const GLOB_META_REGEX = /[*?\[\{]/;

/**
 * Returns true if the input string contains wildcard/glob metacharacters (`*`, `?`, `[`, `{`).
 */
export function hasGlobPattern(input: string): boolean {
  return GLOB_META_REGEX.test(input);
}

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

function splitGlobBaseAndPattern(rawInput: string): { baseDir: string; pattern: string } {
  const normalized = normalizeSlashes(rawInput.trim());
  const segments = normalized.split("/");
  const firstGlobIdx = segments.findIndex((seg) => GLOB_META_REGEX.test(seg));

  if (firstGlobIdx === -1) {
    return { baseDir: resolve(rawInput), pattern: "**/*" };
  }

  const prefixSegments = segments.slice(0, firstGlobIdx);
  const patternSegments = segments.slice(firstGlobIdx);
  let baseDirStr = prefixSegments.join("/");

  if (!baseDirStr) {
    baseDirStr = normalized.startsWith("/") ? "/" : ".";
  } else if (/^[a-zA-Z]:$/.test(baseDirStr)) {
    // Windows drive letter root like "C:" -> "C:/"
    baseDirStr += "/";
  }

  return {
    baseDir: resolve(baseDirStr),
    pattern: patternSegments.join("/") || "*",
  };
}

function joinObjectKey(prefix: string | undefined, relativeKey: string): string {
  const cleanRel = normalizeSlashes(relativeKey).replace(/^\/+/, "");
  if (!prefix || !prefix.trim()) {
    return cleanRel;
  }
  const cleanPrefix = normalizeSlashes(prefix.trim()).replace(/^\/+|\/+$/g, "");
  return cleanPrefix ? `${cleanPrefix}/${cleanRel}` : cleanRel;
}

/**
 * Resolves one or more local inputs (single file, recursive directory, or wildcard glob pattern)
 * into a deduplicated list of upload targets with deterministic S3 object keys.
 */
export async function resolveUploadTargets(
  inputs: string[],
  keyOrPrefix?: string,
  options: { includeHidden?: boolean } = {},
): Promise<ResolvedUploadTarget[]> {
  if (inputs.length === 0) {
    throw new Error("At least one input file, directory, or wildcard pattern is required.");
  }

  const seenPaths = new Set<string>();
  const targets: ResolvedUploadTarget[] = [];
  const includeHidden = Boolean(options.includeHidden);
  const isSingleLiteralInput =
    inputs.length === 1 && !hasGlobPattern(inputs[0]!);

  for (const rawInput of inputs) {
    if (hasGlobPattern(rawInput)) {
      const { baseDir, pattern } = splitGlobBaseAndPattern(rawInput);
      const glob = new Glob(pattern);
      let matchCount = 0;

      for await (const relMatch of glob.scan({
        cwd: baseDir,
        onlyFiles: true,
        dot: includeHidden,
      })) {
        const absFile = resolve(baseDir, relMatch);
        if (seenPaths.has(absFile)) continue;
        seenPaths.add(absFile);
        matchCount++;

        const normalizedRel = normalizeSlashes(relMatch);
        targets.push({
          localPath: absFile,
          relativePath: normalizedRel,
          objectKey: joinObjectKey(keyOrPrefix, normalizedRel),
          sizeBytes: Bun.file(absFile).size,
        });
      }

      if (matchCount === 0) {
        throw new Error(`No files matched wildcard pattern "${rawInput}" (base: "${baseDir}").`);
      }
      continue;
    }

    const inspection = await inspectLocalPathWithShell(rawInput);
    if (!inspection.exists) {
      throw new Error(`Input path does not exist: "${inspection.absolutePath}".`);
    }

    if (inspection.isDirectory) {
      const glob = new Glob("**/*");
      let dirCount = 0;
      for await (const relFile of glob.scan({
        cwd: inspection.absolutePath,
        onlyFiles: true,
        dot: includeHidden,
      })) {
        const absFile = resolve(inspection.absolutePath, relFile);
        if (seenPaths.has(absFile)) continue;
        seenPaths.add(absFile);
        dirCount++;

        const normalizedRel = normalizeSlashes(relFile);
        targets.push({
          localPath: absFile,
          relativePath: normalizedRel,
          objectKey: joinObjectKey(keyOrPrefix, normalizedRel),
          sizeBytes: Bun.file(absFile).size,
        });
      }

      if (dirCount === 0) {
        throw new Error(`Directory "${inspection.absolutePath}" contains no uploadable files.`);
      }
      continue;
    }

    if (!inspection.isFile) {
      throw new Error(`Input path "${inspection.absolutePath}" is not a regular file or directory.`);
    }

    if (seenPaths.has(inspection.absolutePath)) continue;
    seenPaths.add(inspection.absolutePath);

    // If a single file was passed with explicit `--key`, treat `--key` as the full object key.
    // If multiple files were passed with `--key`/`--prefix`, treat it as a key prefix.
    const objectKey = isSingleLiteralInput
      ? (keyOrPrefix?.trim() ? normalizeSlashes(keyOrPrefix.trim()).replace(/^\/+/, "") : inspection.fileName)
      : joinObjectKey(keyOrPrefix, inspection.fileName);

    targets.push({
      localPath: inspection.absolutePath,
      relativePath: inspection.fileName,
      objectKey,
      sizeBytes: inspection.sizeBytes,
    });
  }

  targets.sort((a, b) => a.objectKey.localeCompare(b.objectKey));
  return targets;
}
