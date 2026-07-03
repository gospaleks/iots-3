import { BadRequestException, Controller, Get, Post, Query } from '@nestjs/common';
import { SimulatorService } from '../simulator/simulator.service';

/**
 * Small HTTP control surface for the simulator — lets benchmark scripts drive it
 * (e.g. scenario-c.sh curls /burst) and lets `/health` + `/stats` be polled.
 */
@Controller()
export class ControlController {
  constructor(private readonly simulator: SimulatorService) {}

  @Get('health')
  health() {
    const s = this.simulator.stats();
    return { status: s.running ? 'ok' : 'starting', uptimeMs: s.uptimeMs };
  }

  @Get('stats')
  stats() {
    return this.simulator.stats();
  }

  /** Trigger a burst: POST /burst?durationSec=30 */
  @Post('burst')
  burst(@Query('durationSec') durationSec?: string) {
    const seconds = Number(durationSec ?? 30);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new BadRequestException('durationSec must be a positive number');
    }
    return this.simulator.triggerBurst(Math.floor(seconds));
  }
}
