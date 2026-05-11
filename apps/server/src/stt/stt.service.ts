import { Injectable } from '@nestjs/common';
import { WhisperService } from './whisper.service';
import { splitIntoChunks } from '../_common/chunk';

@Injectable()
export class SttService {
  constructor(private readonly whisper: WhisperService) {}

  /**
   * 업로드된 오디오 버퍼를 Whisper로 전사하고 청크 분할까지 끝낸 결과를 반환한다.
   */
  async transcribeAndChunk(
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ transcript: string; chunks: string[] }> {
    if (!buffer?.length) {
      throw new Error('empty_audio');
    }
    const base64 = buffer.toString('base64');
    const transcript = (await this.whisper.transcribe(base64, mimeType)).trim();
    if (!transcript) {
      throw new Error('empty_transcript');
    }
    const chunks = splitIntoChunks(transcript).filter((c) => c.trim().length > 0);
    return { transcript, chunks };
  }
}
