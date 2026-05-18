import { type ChildProcessWithoutNullStreams, execSync, spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { platform, tmpdir } from 'os';
import { join } from 'path';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { mergePythonVenvIntoEnv } from './python-venv-child-env';
import { resolveWhisperPythonBin, resolveWhisperScriptPath, serverPackageDirFromModuleDir } from './whisper-paths';

/** 단일 요청 처리 한계. 초과 시 워커 행 가능성으로 보고 kill+재시작. */
const PER_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
/** 워커 ready 까지 기다리는 시간 (모델 로드 + 디스크 IO 여유). */
const WORKER_READY_TIMEOUT_MS = 60_000;
/** crash 재시작 백오프 최소/최대. */
const RESTART_BACKOFF_MIN_MS = 500;
const RESTART_BACKOFF_MAX_MS = 10_000;

/**
 * tmp 파일의 확장자만 결정 — ffmpeg 는 헤더로 포맷을 감지하므로 cosmetic 에 가깝지만,
 * 확장자 sniffing 으로 폴백하는 경로를 위해 가능한 정확히 매핑.
 */
function pickExt(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes('wav') || m.includes('wave')) return 'wav';
  if (m.includes('webm')) return 'webm';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('flac')) return 'flac';
  if (m.includes('opus')) return 'opus';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('aac')) return 'aac';
  if (m.includes('aiff') || m.includes('aif')) return 'aiff';
  if (m.includes('3gpp') || m.includes('3gp')) return '3gp';
  if (m.includes('amr')) return 'amr';
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

function whisperSpawn(pythonBin: string, scriptPath: string): { cmd: string; args: string[] } {
  const args = ['-u', scriptPath];
  if (isDarwinAppleSiliconHardware()) {
    return { cmd: '/usr/bin/arch', args: ['-arm64', pythonBin, ...args] };
  }
  return { cmd: pythonBin, args };
}

type WorkerStdoutMsg =
  | { type: 'ready'; model?: string; device?: string; compute_type?: string }
  | { type: 'fatal'; error: string; message?: string }
  | { type: 'result'; id: string; text?: string; error?: string; message?: string };

type PendingRequest = {
  id: string;
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * faster-whisper 모델을 **장기 실행 Python 워커**에 상주시키고 stdin/stdout 라인 JSON 으로 통신한다.
 * 매 요청마다 subprocess spawn + 모델 재로드(5~15초) 비용을 제거하기 위함.
 *
 * 동시성: faster-whisper 의 transcribe 는 thread-safe 하지 않아 한 워커에서 동시에 호출할 수 없다.
 *        Promise queue 로 직렬화. 추후 워커 풀이 필요하면 별도로 도입.
 */
@Injectable()
export class WhisperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhisperService.name);

  private child: ChildProcessWithoutNullStreams | null = null;
  private childExited = false;
  private readyPromise: Promise<void> | null = null;
  private stdoutBuf = '';
  private readonly pending = new Map<string, PendingRequest>();
  /** 직렬화 큐: 마지막 inflight 작업의 Promise. */
  private queueTail: Promise<unknown> = Promise.resolve();
  private restartBackoff = RESTART_BACKOFF_MIN_MS;
  private destroyed = false;

  onModuleInit(): void {
    // 모델 로드는 5~15s. 부팅을 막지 않도록 await 하지 않는다 — 첫 요청이 ready 까지 기다린다.
    this.ensureWorker().catch(err => {
      this.logger.warn(`[Whisper] 초기 워커 부팅 실패: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    this.killWorker('module_destroy');
  }

  async transcribe(audio: Buffer, mimeType: string): Promise<string> {
    if (!audio.length) return '';

    // 직렬화: 앞의 작업이 끝난 뒤 내 작업을 실행. 실패해도 큐는 계속 진행되도록 catch.
    const prev = this.queueTail;
    const run = prev.catch(() => undefined).then(() => this.runOne(audio, mimeType));
    this.queueTail = run.catch(() => undefined);
    return run;
  }

  private async runOne(audio: Buffer, mimeType: string): Promise<string> {
    const ext = pickExt(mimeType);
    const tmpFile = join(tmpdir(), `room-whisper-${randomBytes(12).toString('hex')}.${ext}`);
    writeFileSync(tmpFile, audio);
    try {
      const child = await this.ensureWorker();
      const id = randomBytes(8).toString('hex');
      const payload = JSON.stringify({ type: 'transcribe', id, audioPath: tmpFile, mimeType }) + '\n';

      return await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          this.logger.warn(`[Whisper] 요청 ${id} ${PER_REQUEST_TIMEOUT_MS}ms 타임아웃 → 워커 재시작`);
          // 워커가 행에 빠졌을 가능성. kill 하면 'exit' 핸들러가 다른 pending 까지 정리.
          this.killWorker('request_timeout');
          reject(new Error('whisper_timeout'));
        }, PER_REQUEST_TIMEOUT_MS);

        this.pending.set(id, { id, resolve, reject, timer });
        if (!child.stdin.write(payload)) {
          // backpressure 시 drain 까지 기다리지 않음 — 노드가 알아서 버퍼링. 에러는 'error' 이벤트로.
        }
      });
    } finally {
      if (existsSync(tmpFile)) {
        try {
          unlinkSync(tmpFile);
        } catch {
          // best-effort
        }
      }
    }
  }

  private async ensureWorker(): Promise<ChildProcessWithoutNullStreams> {
    if (this.destroyed) throw new Error('whisper_service_destroyed');
    if (this.child && !this.childExited) {
      if (this.readyPromise) await this.readyPromise;
      return this.child;
    }
    this.spawnWorker();
    if (this.readyPromise) await this.readyPromise;
    if (!this.child) throw new Error('whisper_spawn_failed');
    return this.child;
  }

  private spawnWorker(): void {
    const pkg = serverPackageDirFromModuleDir(__dirname);
    const scriptPath = resolveWhisperScriptPath(pkg);
    const pythonBin = resolveWhisperPythonBin(pkg);
    const childEnv = mergePythonVenvIntoEnv(pythonBin, {
      ...process.env,
      PYTHONUNBUFFERED: '1',
    });
    const { cmd, args } = whisperSpawn(pythonBin, scriptPath);
    this.logger.log(`[Whisper] 워커 spawn cmd=${cmd} script=${scriptPath}`);
    const child = spawn(cmd, args, { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams;
    this.child = child;
    this.childExited = false;
    this.stdoutBuf = '';

    let resolveReady!: () => void;
    let rejectReady!: (e: Error) => void;
    const ready = new Promise<void>((res, rej) => {
      resolveReady = res;
      rejectReady = rej;
    });
    this.readyPromise = ready;
    const readyTimer = setTimeout(() => {
      rejectReady(new Error('whisper_ready_timeout'));
    }, WORKER_READY_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      this.stdoutBuf += chunk.toString('utf8');
      let nl: number;
      while ((nl = this.stdoutBuf.indexOf('\n')) !== -1) {
        const line = this.stdoutBuf.slice(0, nl).trim();
        this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
        if (!line) continue;
        let msg: WorkerStdoutMsg;
        try {
          msg = JSON.parse(line) as WorkerStdoutMsg;
        } catch (e) {
          this.logger.warn(`[Whisper] stdout 파싱 실패: ${line.slice(0, 400)} (${e})`);
          continue;
        }
        this.handleStdoutMessage(msg, resolveReady, rejectReady, readyTimer);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      for (const one of s.split('\n')) {
        const t = one.trim();
        if (!t) continue;
        if (t.includes('"stage"')) {
          this.logger.log(`[Whisper] ${t}`);
        }
      }
    });

    child.on('error', e => {
      this.logger.error(`[Whisper] spawn 실패: ${e}`);
      clearTimeout(readyTimer);
      rejectReady(e instanceof Error ? e : new Error(String(e)));
    });

    child.on('exit', (code, signal) => {
      clearTimeout(readyTimer);
      this.childExited = true;
      this.logger.warn(`[Whisper] 워커 종료 code=${code} signal=${signal} pending=${this.pending.size}`);
      // pending 전부 reject — 부모(transcribe) 에서 호출자에게 에러로 올라감.
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error(`whisper_worker_exited code=${code} signal=${signal}`));
      }
      this.pending.clear();
      // ready 미수신 상태로 죽으면 readyPromise 도 reject.
      rejectReady(new Error(`whisper_worker_exited_before_ready code=${code} signal=${signal}`));

      if (this.destroyed) return;
      const delay = this.restartBackoff;
      this.restartBackoff = Math.min(RESTART_BACKOFF_MAX_MS, this.restartBackoff * 2);
      setTimeout(() => {
        if (this.destroyed) return;
        this.logger.log(`[Whisper] 워커 재시작 (backoff ${delay}ms)`);
        this.spawnWorker();
      }, delay);
    });
  }

  private handleStdoutMessage(
    msg: WorkerStdoutMsg,
    resolveReady: () => void,
    rejectReady: (e: Error) => void,
    readyTimer: ReturnType<typeof setTimeout>,
  ): void {
    if (msg.type === 'ready') {
      clearTimeout(readyTimer);
      this.restartBackoff = RESTART_BACKOFF_MIN_MS;
      this.logger.log(
        `[Whisper] 워커 ready model=${msg.model} device=${msg.device} compute_type=${msg.compute_type}`,
      );
      resolveReady();
      return;
    }
    if (msg.type === 'fatal') {
      this.logger.error(`[Whisper] 워커 fatal: ${msg.error} ${msg.message ?? ''}`);
      clearTimeout(readyTimer);
      rejectReady(new Error(`whisper_fatal:${msg.error}`));
      return;
    }
    if (msg.type === 'result') {
      const pending = this.pending.get(msg.id);
      if (!pending) {
        this.logger.warn(`[Whisper] unknown result id=${msg.id}`);
        return;
      }
      this.pending.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.error) {
        pending.reject(new Error(`whisper_${msg.error}:${msg.message ?? ''}`));
      } else {
        pending.resolve((msg.text ?? '').trim());
      }
    }
  }

  private killWorker(reason: string): void {
    const child = this.child;
    if (!child || this.childExited) return;
    this.logger.warn(`[Whisper] 워커 강제 종료 (${reason})`);
    try {
      child.kill('SIGKILL');
    } catch (e) {
      this.logger.warn(`[Whisper] kill 실패: ${e}`);
    }
  }
}
