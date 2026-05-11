import { Module } from '@nestjs/common';
import { LlmModule } from '../_common/llm/llm.module';
import { EmbedController } from './embed.controller';
import { EmbedService } from './embed.service';

@Module({
  imports: [LlmModule],
  controllers: [EmbedController],
  providers: [EmbedService],
  exports: [EmbedService],
})
export class EmbedModule {}
