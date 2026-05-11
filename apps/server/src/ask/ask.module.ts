import { Module } from '@nestjs/common';
import { LlmModule } from '../_common/llm/llm.module';
import { AskController } from './ask.controller';
import { AskService } from './ask.service';

@Module({
  imports: [LlmModule],
  controllers: [AskController],
  providers: [AskService],
  exports: [AskService],
})
export class AskModule {}
