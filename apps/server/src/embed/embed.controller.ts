import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  PayloadTooLargeException,
  Post,
} from '@nestjs/common';
import type { EmbedBody, EmbedResponse } from '@koorooroong-eum/shared-types';
import { EmbedService } from './embed.service';

@Controller('embed')
export class EmbedController {
  constructor(private readonly embed: EmbedService) {}

  @Post()
  async create(
    @Body() body: EmbedBody,
  ): Promise<{ ok: true; data: EmbedResponse }> {
    if (!body || !Array.isArray(body.texts)) {
      throw new BadRequestException('texts required');
    }
    try {
      const vectors = await this.embed.embedTexts(body.texts);
      return { ok: true, data: { vectors } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'empty_texts') throw new BadRequestException('empty texts');
      if (msg === 'too_many_texts') throw new PayloadTooLargeException('too many texts (max 200)');
      if (err instanceof HttpException) throw err;
      throw err;
    }
  }
}
