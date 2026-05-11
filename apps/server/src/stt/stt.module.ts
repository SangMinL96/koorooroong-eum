import { Module } from '@nestjs/common';
import { SttController } from './stt.controller';
import { SttService } from './stt.service';
import { WhisperService } from './whisper.service';

@Module({
  controllers: [SttController],
  providers: [SttService, WhisperService],
  exports: [SttService],
})
export class SttModule {}
