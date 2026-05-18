import {
  BadRequestException,
  Controller,
  HttpException,
  Post,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import 'multer';
import type { SttResponse } from '@koorooroong-eum/shared-types';
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
  constructor(private readonly stt: SttService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_AUDIO_BYTES },
    }),
  )
  async transcribe(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ ok: true; data: SttResponse }> {
    if (!file) {
      throw new BadRequestException('file required');
    }
    if (!ALLOWED_AUDIO_MIME.has(file.mimetype)) {
      throw new UnsupportedMediaTypeException(`unsupported mimetype: ${file.mimetype}`);
    }
    try {
      const data = await this.stt.transcribeAndChunk(file.buffer, file.mimetype);
      return { ok: true, data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'empty_audio') {
        throw new BadRequestException('empty audio');
      }
      if (msg === 'empty_transcript') {
        throw new UnprocessableEntityException('empty transcript');
      }
      if (err instanceof HttpException) throw err;
      throw err;
    }
  }
}
