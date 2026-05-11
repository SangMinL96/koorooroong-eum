import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class LoggerService {
  private readonly logger = new Logger('App');

  error(message: string, context?: string): void {
    this.logger.error(message, context);
  }

  log(message: string, context?: string): void {
    this.logger.log(message, context);
  }

  warn(message: string, context?: string): void {
    this.logger.warn(message, context);
  }
}
