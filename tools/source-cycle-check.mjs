import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const SOURCE_RUNTIME_CYCLE_POLICY_V1 = 'SOURCE_RUNTIME_CYCLE_POLICY_V1';
const ignored = new Set([
  'node_modules',
  '.git',
  'release',
  'coverage',
  'artifacts',
  'generated',
  'out',
  'frozen-candidates',
  '.runtime-stage',
]);
const sourceFile = (file) =>
  /\.(?:ts|tsx|mts|cts)$/u.test(file) && !/\.d\.(?:ts|mts|cts)$/u.test(file);
function canonical(file) {
  file = resolve(file);
  let parent = file;
  while (!existsSync(parent)) parent = dirname(parent);
  return join(realpathSync(parent), relative(parent, file));
}

function discover(root) {
  const files = [],
    configs = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name, 'en'),
    )) {
      if (ignored.has(entry.name) || entry.name.startsWith('dist')) continue;
      const file = join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) {
        if (sourceFile(file)) files.push(canonical(file));
        if (/^tsconfig(?:\.[^.]+)?\.json$/u.test(entry.name) && entry.name !== 'tsconfig.base.json')
          configs.push(file);
      }
    }
  }
  walk(root);
  return { files: [...new Set(files)].sort(), configs: configs.sort() };
}

function readProject(file) {
  const project = ts.getParsedCommandLineOfConfigFile(
    file,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      },
    },
  );
  if (!project || project.errors.length) throw new Error(`SOURCE_CYCLE_CONFIG_INVALID: ${file}`);
  return project;
}

function runtimeSpecifier(statement) {
  if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) return null;
  if (statement.isTypeOnly || statement.importClause?.isTypeOnly) return null;
  const bindings = statement.importClause?.namedBindings ?? statement.exportClause;
  if (
    bindings?.elements?.length &&
    !statement.importClause?.name &&
    bindings.elements.every((element) => element.isTypeOnly)
  )
    return null;
  return statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
    ? statement.moduleSpecifier.text
    : null;
}

export function checkSourceCycles({ root = process.cwd() } = {}) {
  const started = performance.now();
  root = canonical(root);
  const { files, configs } = discover(root);
  const projects = configs.map((file) => ({ file, ...readProject(file) }));
  const optionsByFile = new Map();
  const outputs = new Map();
  // Derive workspace output -> source bindings from compiler output authority,
  // including declarations exposed by workspace package.json exports.
  for (const project of projects) {
    for (const file of project.fileNames) {
      if (!sourceFile(file)) continue;
      const source = canonical(file);
      const current = optionsByFile.get(source);
      if (!current || project.file.length > current.file.length) optionsByFile.set(source, project);
      if (!project.options.noEmit && project.options.outDir) {
        for (const output of ts.getOutputFileNames(project, file, false))
          outputs.set(canonical(output), source);
      }
    }
  }
  const baseFile = join(root, 'tsconfig.base.json');
  const fallback = existsSync(baseFile)
    ? ts.convertCompilerOptionsFromJson(
        JSON.parse(readFileSync(baseFile, 'utf8')).compilerOptions ?? {},
        root,
      ).options
    : {
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        module: ts.ModuleKind.NodeNext,
        target: ts.ScriptTarget.ES2022,
      };
  const outputDirectories = new Set();
  for (const output of outputs.keys()) {
    let directory = dirname(output);
    while (directory.startsWith(root)) {
      outputDirectories.add(directory);
      if (directory === dirname(directory)) break;
      directory = dirname(directory);
    }
  }
  const host = {
    ...ts.sys,
    fileExists: (file) => outputs.has(canonical(file)) || ts.sys.fileExists(file),
    realpath: canonical,
    directoryExists: (directory) =>
      outputDirectories.has(canonical(directory)) || ts.sys.directoryExists(directory),
  };
  const caches = new Map();
  const graph = new Map(files.map((file) => [file, []]));
  let edges = 0;
  for (const file of files) {
    const project = optionsByFile.get(file);
    const options = project?.options ?? fallback;
    const key = project?.file ?? 'fallback';
    if (!caches.has(key))
      caches.set(
        key,
        ts.createModuleResolutionCache(root, (file) => file, options),
      );
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    if (source.parseDiagnostics.length)
      throw new Error(`SOURCE_CYCLE_PARSE_INVALID: ${relative(root, file)}`);
    const targets = new Set();
    for (const statement of source.statements) {
      const specifier = runtimeSpecifier(statement);
      if (!specifier) continue;
      const resolved = ts.resolveModuleName(specifier, file, options, host, caches.get(key))
        .resolvedModule?.resolvedFileName;
      if (!resolved) continue;
      const target = canonical(outputs.get(canonical(resolved)) ?? resolved);
      if (target !== file && graph.has(target)) targets.add(target);
    }
    graph.set(file, [...targets].sort());
    edges += targets.size;
  }
  // Sorted DFS yields deterministic cycle witnesses without enumerating paths.
  const active = new Map(),
    done = new Set(),
    cycles = [],
    reported = new Set();
  function visit(node, stack) {
    if (active.has(node)) {
      if (cycles.length >= 20) return;
      const cycle = [...stack.slice(active.get(node)), node];
      const key = cycle.slice(0, -1).sort().join('\n');
      if (!reported.has(key)) {
        reported.add(key);
        cycles.push(cycle.map((file) => relative(root, file).replaceAll('\\', '/')));
      }
      return;
    }
    if (done.has(node)) return;
    active.set(node, stack.length);
    stack.push(node);
    for (const target of graph.get(node)) visit(target, stack);
    stack.pop();
    active.delete(node);
    done.add(node);
  }
  for (const file of files) visit(file, []);
  return {
    policy_id: SOURCE_RUNTIME_CYCLE_POLICY_V1,
    cycles,
    file_count: files.length,
    edge_count: edges,
    duration_ms: Math.round(performance.now() - started),
  };
}

if (process.argv[1] && canonical(process.argv[1]) === canonical(fileURLToPath(import.meta.url))) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--root' || !isAbsolute(args[1])))
      throw new Error('SOURCE_CYCLE_ARGUMENT_INVALID');
    const result = checkSourceCycles({ root: args[1] ?? process.cwd() });
    for (const cycle of result.cycles.slice(0, 20))
      console.error(`SOURCE_RUNTIME_CYCLE:\n${cycle.join('\n→ ')}`);
    if (result.cycles.length > 20)
      console.error(`SOURCE_RUNTIME_CYCLE: ${result.cycles.length - 20} additional witnesses`);
    if (!result.cycles.length)
      console.info(
        `source-runtime-cycle: PASS (${result.file_count} files; ${result.edge_count} edges; ${result.duration_ms}ms)`,
      );
    process.exitCode = result.cycles.length ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
