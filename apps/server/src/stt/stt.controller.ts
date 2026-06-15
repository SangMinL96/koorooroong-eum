import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import 'multer';
import type { SttJobCreated, SttJobStatus } from '@koorooroong-eum/shared-types';
import { SttService } from './stt.service';

// ffmpeg(faster-whisper 의존)가 디코딩 가능한 보편 오디오 포맷.
// 새로 추가하는 경우 whisper.service.ts 의 pickExt 도 함께 갱신할 것.
const ALLOWED_AUDIO_MIME = new Set([
  // M4A / MP4 audio
  'audio/m4a',
  'audio/mp4',
  'audio/x-m4a',
  // MP3
  'audio/mpeg',
  'audio/mp3',
  // WAV
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave',
  // WebM
  'audio/webm',
  // AAC (raw)
  'audio/aac',
  'audio/x-aac',
  // Ogg / Opus
  'audio/ogg',
  'audio/opus',
  'application/ogg',
  // FLAC
  'audio/flac',
  'audio/x-flac',
  // 3GP / 3GPP (Android 일부 녹음 앱 기본)
  'audio/3gpp',
  'audio/3gpp2',
  // AIFF
  'audio/aiff',
  'audio/x-aiff',
  // AMR (구형 Android 음성 메모)
  'audio/amr',
  'audio/amr-wb',
]);
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

@Controller('stt')
export class SttController {
  private readonly logger = new Logger(SttController.name);

  constructor(private readonly stt: SttService) {}

  /**
   * 업로드만 받고 즉시 jobId 를 반환(202). 전사는 백그라운드에서 진행되며,
   * 결과는 GET /stt/:jobId 폴링으로 가져간다. (긴 동기 응답으로 인한 클라이언트 타임아웃 회피)
   */
  @Post()
  @HttpCode(202)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_AUDIO_BYTES },
    }),
  )
  async enqueue(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ ok: true; data: SttJobCreated }> {
    if (!file) {
      throw new BadRequestException('file required');
    }
    if (!ALLOWED_AUDIO_MIME.has(file.mimetype)) {
      throw new UnsupportedMediaTypeException(`unsupported mimetype: ${file.mimetype}`);
    }
    if (!file.buffer?.length) {
      throw new BadRequestException('empty audio');
    }
    const jobId = this.stt.createJob(file.buffer, file.mimetype);
    this.logger.log(
      `[Stt] enqueue jobId=${jobId} mime=${file.mimetype} bytes=${file.buffer.length}`,
    );
    return { ok: true, data: { jobId } };
  }

  /** 작업 상태 폴링. processing / done(결과 포함) / error 를 반환. 미존재 jobId 는 404. */
  @Get(':jobId')
  status(@Param('jobId') jobId: string): { ok: true; data: SttJobStatus } {
    const job = this.stt.getJob(jobId);
    if (!job) {
      this.logger.warn(`[Stt] poll jobId=${jobId} → 404 (미존재/유실)`);
      throw new NotFoundException('job not found');
    }
    this.logger.log(`[Stt] poll jobId=${jobId} → ${job.status}`);
    return { ok: true, data: job };
  }
}
