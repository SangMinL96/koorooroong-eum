import { Module } from '@nestjs/common';
import { LlmModule } from '../_common/llm/llm.module';
import { SummarizeController } from './summarize.controller';
import { SummarizeService } from './summarize.service';

@Module({
  imports: [LlmModule],
  controllers: [SummarizeController],
  providers: [SummarizeService],
  exports: [SummarizeService],
})
export class SummarizeModule {}
