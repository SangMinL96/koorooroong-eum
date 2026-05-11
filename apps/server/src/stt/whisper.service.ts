import { execSync, spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { platform, tmpdir } from 'os';
import { join } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { mergePythonVenvIntoEnv } from './python-venv-child-env';
import { resolveWhisperPythonBin, resolveWhisperScriptPath, serverPackageDirFromModuleDir } from './whisper-paths';

const TIMEOUT_MS = 120_000;

function pickExt(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes('wav')) return 'wav';
  if (m.includes('webm')) return 'webm';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  return 'm4a';
}

/**
 * Rosetta(x64) Node는 os.machine()/process.arch 만으로 arm 맥을 안정적으로 못 잡는다.
 * Apple 공식 sysctl: Apple Silicon 이면 hw.optional.arm64 == 1.
 * 그때만 자식 Python을 arch -arm64 로 고정 (venv 의 arm64 전용 .so 와 일치).
 */
let darwinAppleSiliconHw: boolean | undefined;

function isDarwinAppleSiliconHardware(): boolean {
  if (darwinAppleSiliconHw !== undefined) return darwinAppleSiliconHw;
  if (platform() !== 'darwin') {
    darwinAppleSiliconHw = false;
    return false;
  }
  try {
    const v = execSync('/usr/sbin/sysctl -n hw.optional.arm64', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();
    darwinAppleSiliconHw = v === '1';
  } catch {
    darwinAppleSiliconHw = false;
  }
  return darwinAppleSiliconHw;
}

function whisperSpawn(pythonBin: string, scriptPath: string, audioPath: string): { cmd: string; args: string[] } {
  const args = ['-u', scriptPath, audioPath];
  if (isDarwinAppleSiliconHardware()) {
    return { cmd: '/usr/bin/arch', args: ['-arm64', pythonBin, ...args] };
  }
  return { cmd: pythonBin, args };
}

function parseStdoutJsonLine(out: string): { text?: string; error?: string; message?: string } {
  const line =
    out
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .pop() ?? '{}';
  return JSON.parse(line) as { text?: string; error?: string; message?: string };
}

@Injectable()
export class WhisperService {
  private readonly logger = new Logger(WhisperService.name);

  transcribe(base64: string, mimeType: string): Promise<string> {
    const pkg = serverPackageDirFromModuleDir(__dirname);
    const scriptPath = resolveWhisperScriptPath(pkg);
    const pythonBin = resolveWhisperPythonBin(pkg);
    const buffer = Buffer.from(base64, 'base64');
    const ext = pickExt(mimeType);
    const tmpFile = join(tmpdir(), `room-whisper-${randomBytes(12).toString('hex')}.${ext}`);
    writeFileSync(tmpFile, buffer);
    const childEnv = mergePythonVenvIntoEnv(pythonBin, {
      ...process.env,
      PYTHONUNBUFFERED: '1',
    });
    const { cmd, args } = whisperSpawn(pythonBin, scriptPath, tmpFile);
    return new Promise(resolve => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (text: string) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (existsSync(tmpFile)) unlinkSync(tmpFile);
        resolve(text);
      };

      const child = spawn(cmd, args, { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        const s = chunk.toString('utf8');
        err += s;
        const one = s.trim().split('\n').find(Boolean);
        if (one && one.includes('"stage"')) {
          this.logger.log(`[Whisper] ${one}`);
        }
      });
      timer = setTimeout(() => {
        this.logger.warn(`[Whisper] ${TIMEOUT_MS}ms 타임아웃, SIGKILL`);
        child.kill('SIGKILL');
      }, TIMEOUT_MS);
      child.on('error', e => {
        this.logger.error(`[Whisper] spawn 실패: ${e}`);
        finish('');
      });
      child.on('close', exitCode => {
        let text = '';
        try {
          const parsed = parseStdoutJsonLine(out);
          if (parsed.error) {
            this.logger.warn(`[Whisper] ${parsed.error}: ${parsed.message ?? ''} stderr=${err.slice(-500)}`);
          } else if (typeof parsed.text === 'string') {
            text = parsed.text.trim();
          }
        } catch (e) {
          this.logger.warn(`[Whisper] stdout parse exit=${exitCode} tail=${out.slice(-400)} err=${err.slice(-400)} ${e}`);
        }
        this.logger.log(`[Whisper] 종료 exit=${exitCode} textLen=${text.length}`);
        finish(text);
      });
    });
  }
}
