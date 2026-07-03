import { Controller, Get } from '@nestjs/common';
import { SensorWriterService } from '../storage/sensor-writer.service';
import { SubscriberService } from '../storage/subscriber.service';

/** Read-only control surface for monitoring storage (/health, /stats). */
@Controller()
export class ControlController {
  constructor(
    private readonly writer: SensorWriterService,
    private readonly subscriber: SubscriberService,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Get('stats')
  stats() {
    return {
      writer: this.writer.stats(),
      ...this.subscriber.stats(),
    };
  }
}
