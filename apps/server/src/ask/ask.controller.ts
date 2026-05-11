import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  Post,
} from '@nestjs/common';
import type { AskBody, AskResponse } from '@koorooroong-eum/shared-types';
import { AskService } from './ask.service';

@Controller('ask')
export class AskController {
  constructor(private readonly askService: AskService) {}

  @Post()
  async ask(
    @Body() body: AskBody,
  ): Promise<{ ok: true; data: AskResponse }> {
    if (!body || typeof body.question !== 'string') {
      throw new BadRequestException('question required');
    }
    if (!Array.isArray(body.contexts)) {
      throw new BadRequestException('contexts required (can be empty)');
    }
    try {
      const data = await this.askService.ask(body);
      return { ok: true, data };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw err;
    }
  }
}
