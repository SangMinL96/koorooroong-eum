import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmModule } from './_common/llm/llm.module';
import { LoggerModule } from './_common/logger/logger.module';
import { SttModule } from './stt/stt.module';
import { EmbedModule } from './embed/embed.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LlmModule,
    LoggerModule,
    SttModule,
    EmbedModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
