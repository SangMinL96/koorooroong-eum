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

const ALLOWED_AUDIO_MIME = new Set([
  'audio/m4a',
  'audio/mp4',
  'audio/x-m4a',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
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
