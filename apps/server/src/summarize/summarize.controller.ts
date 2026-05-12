import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  Post,
} from '@nestjs/common';
import type { SummarizeBody, SummarizeResponse } from '@koorooroong-eum/shared-types';
import { SummarizeService } from './summarize.service';

@Controller('summarize')
export class SummarizeController {
  constructor(private readonly summarizeService: SummarizeService) {}

  @Post()
  async summarize(
    @Body() body: SummarizeBody,
  ): Promise<{ ok: true; data: SummarizeResponse }> {
    if (!body || typeof body.text !== 'string') {
      throw new BadRequestException('text required');
    }
    try {
      const data = await this.summarizeService.summarize(body);
      return { ok: true, data };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw err;
    }
  }
}
