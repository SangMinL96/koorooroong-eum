import { Injectable } from '@nestjs/common';
import { LlmService } from '../_common/llm/llm.service';

const MAX_TEXTS = 200;

@Injectable()
export class EmbedService {
  constructor(private readonly llm: LlmService) {}

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (!Array.isArray(texts) || texts.length === 0) {
      throw new Error('empty_texts');
    }
    if (texts.length > MAX_TEXTS) {
      throw new Error('too_many_texts');
    }
    const trimmed = texts.map((t) => (typeof t === 'string' ? t : ''));
    return this.llm.embedTexts(trimmed);
  }
}
