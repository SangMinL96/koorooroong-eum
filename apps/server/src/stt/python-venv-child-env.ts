import { existsSync, readdirSync } from 'fs';
import { dirname, join, resolve } from 'path';

function isVenvRoot(dir: string): boolean {
  return existsSync(join(dir, 'pyvenv.cfg'));
}

function findUnixSitePackages(venvRoot: string): string | null {
  const lib = join(venvRoot, 'lib');
  if (!existsSync(lib)) return null;
  for (const name of readdirSync(lib)) {
    if (!name.startsWith('python')) continue;
    const sp = join(lib, name, 'site-packages');
    if (existsSync(sp)) return sp;
  }
  return null;
}

function findWindowsSitePackages(venvRoot: string): string | null {
  const sp = join(venvRoot, 'Lib', 'site-packages');
  return existsSync(sp) ? sp : null;
}

function pathLooksLikeVenvBin(resolved: string): boolean {
  const norm = resolved.replace(/\\/g, '/');
  return (
    /\/\.venv[^/]*\/bin\//.test(norm) ||
    /\/venv\/bin\//.test(norm) ||
    /\\\.venv[^\\]*\\bin\\/.test(resolved) ||
    /\\venv\\bin\\/.test(resolved)
  );
}

export function mergePythonVenvIntoEnv(pythonExecutable: string, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  const resolved = resolve(pythonExecutable.trim());
  if (!existsSync(resolved)) return env;
  const binDir = dirname(resolved);
  const venvRoot = resolve(join(binDir, '..'));
  if (!isVenvRoot(venvRoot) && !pathLooksLikeVenvBin(resolved)) return env;
  const site = findUnixSitePackages(venvRoot) ?? findWindowsSitePackages(venvRoot);
  const sep = process.platform === 'win32' ? ';' : ':';
  if (site) {
    env.PYTHONPATH = env.PYTHONPATH ? `${site}${sep}${env.PYTHONPATH}` : site;
    env.ROOM_WHISPER_SITE_PACKAGES = site;
  }
  env.VIRTUAL_ENV = venvRoot;
  env.PATH = `${binDir}${sep}${env.PATH ?? ''}`;
  env.PYTHONNOUSERSITE = '1';
  delete env.PYTHONHOME;
  return env;
}
