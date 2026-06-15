import { randomBytes } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { SttJobStatus, SttResponse } from '@koorooroong-eum/shared-types';
import { WhisperService } from './whisper.service';
import { splitIntoChunks } from '../_common/chunk';

/** 완료/실패한 작업을 메모리에 보관하는 시간. 클라이언트 폴링이 결과를 가져갈 여유. */
const JOB_RETENTION_MS = 5 * 60 * 1000;

@Injectable()
export class SttService {
  private readonly logger = new Logger(SttService.name);
  /** jobId → 현재 상태. 단일 서버 인메모리 (재시작 시 유실, 폴링은 404 로 실패). */
  private readonly jobs = new Map<string, SttJobStatus>();

  constructor(private readonly whisper: WhisperService) {}

  /**
   * 업로드 버퍼를 받아 작업을 등록하고 백그라운드 전사를 시작한다.
   * 위스퍼 전사는 수십 초~수 분이 걸려 동기 응답 시 클라이언트가 타임아웃되므로,
   * 여기서는 즉시 jobId 만 반환하고 결과는 GET /stt/:jobId 폴링으로 전달한다.
   */
  createJob(buffer: Buffer, mimeType: string): string {
    const jobId = randomBytes(12).toString('hex');
    this.jobs.set(jobId, { status: 'processing' });
    void this.process(jobId, buffer, mimeType);
    return jobId;
  }

  getJob(jobId: string): SttJobStatus | undefined {
    return this.jobs.get(jobId);
  }

  private async process(jobId: string, buffer: Buffer, mimeType: string): Promise<void> {
    try {
      const result = await this.transcribeAndChunk(buffer, mimeType);
      this.jobs.set(jobId, { status: 'done', result });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[Stt] 작업 ${jobId} 실패: ${error}`);
      this.jobs.set(jobId, { status: 'error', error });
    } finally {
      // 완료/실패 후 일정 시간 뒤 정리. 폴링이 가져갈 시간은 충분히 준다.
      const t = setTimeout(() => this.jobs.delete(jobId), JOB_RETENTION_MS);
      t.unref?.();
    }
  }

  /**
   * 업로드된 오디오 버퍼를 Whisper로 전사하고 청크 분할까지 끝낸 결과를 반환한다.
   */
  async transcribeAndChunk(buffer: Buffer, mimeType: string): Promise<SttResponse> {
    if (!buffer?.length) {
      throw new Error('empty_audio');
    }
    const transcript = (await this.whisper.transcribe(buffer, mimeType)).trim();
    if (!transcript) {
      throw new Error('empty_transcript');
    }
    const chunks = splitIntoChunks(transcript).filter((c) => c.trim().length > 0);
    return { transcript, chunks };
  }
}
