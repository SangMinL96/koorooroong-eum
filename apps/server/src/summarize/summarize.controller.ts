import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  Post,
  ServiceUnavailableException,
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
      // Gemini 일시 과부하(503/500/429)는 서비스 측 이슈이므로 사용자에게는 친화적 메시지로 변환.
      const msg = err instanceof Error ? err.message : String(err);
      if (/UNAVAILABLE|503|500|INTERNAL|429|RESOURCE_EXHAUSTED|deadline/i.test(msg)) {
        throw new ServiceUnavailableException(
          'Gemini가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해주세요.',
        );
      }
      throw err;
    }
  }
}
