import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmModule } from './_common/llm/llm.module';
import { LoggerModule } from './_common/logger/logger.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LlmModule,
    LoggerModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
