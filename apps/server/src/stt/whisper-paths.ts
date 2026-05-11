import { existsSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Nest 패키지 루트 = `apps/server` (런타임 `__dirname`이 `…/dist/stt` 또는 `…/src/stt`일 때 그 상위 두 단계).
 * `yarn dev`의 cwd가 루트든 `apps/server`든 여기서 계산한 경로는 동일하다.
 */
export function serverPackageDirFromModuleDir(moduleDir: string): string {
  return resolve(join(moduleDir, '..', '..'));
}

export function resolveWhisperPythonBin(serverPackageDir: string): string {
  const fromEnv = process.env.ROOM_WHISPER_PYTHON?.trim();
  if (fromEnv) {
    const abs = resolve(fromEnv);
    return existsSync(abs) ? abs : fromEnv;
  }
  const monorepoRoot = resolve(serverPackageDir, '..', '..');
  const candidates = [
    join(monorepoRoot, '.venv-whisper', 'bin', 'python'),
    join(monorepoRoot, '.venv-whisper', 'bin', 'python3'),
    join(serverPackageDir, '.venv-whisper', 'bin', 'python'),
    join(serverPackageDir, '.venv-whisper', 'bin', 'python3'),
    resolve(process.cwd(), '.venv-whisper', 'bin', 'python'),
    resolve(process.cwd(), '.venv-whisper', 'bin', 'python3'),
    resolve(process.cwd(), '..', '.venv-whisper', 'bin', 'python'),
    resolve(process.cwd(), '..', '..', '.venv-whisper', 'bin', 'python'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return 'python3';
}

export function resolveWhisperScriptPath(serverPackageDir: string): string {
  const fromEnv = process.env.ROOM_WHISPER_SCRIPT?.trim();
  if (fromEnv) return resolve(fromEnv);
  const bundled = resolve(join(serverPackageDir, 'scripts', 'whisper.py'));
  if (existsSync(bundled)) return bundled;
  for (const p of [
    join(process.cwd(), 'scripts', 'whisper.py'),
    join(process.cwd(), 'apps', 'server', 'scripts', 'whisper.py'),
  ]) {
    const abs = resolve(p);
    if (existsSync(abs)) return abs;
  }
  return bundled;
}
