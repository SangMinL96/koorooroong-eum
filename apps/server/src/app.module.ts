import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmModule } from './_common/llm/llm.module';
import { LoggerModule } from './_common/logger/logger.module';
import { SttModule } from './stt/stt.module';
import { EmbedModule } from './embed/embed.module';
import { AskModule } from './ask/ask.module';
import { SummarizeModule } from './summarize/summarize.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LlmModule,
    LoggerModule,
    SttModule,
    EmbedModule,
    AskModule,
    SummarizeModule,
    HealthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
