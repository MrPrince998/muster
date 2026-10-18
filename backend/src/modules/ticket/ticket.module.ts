import { Module } from '@nestjs/common';
import { TicketService } from './ticket.service.js';

/** Signs and checks tickets (and guests' confirmation links). No dependencies: config only. */
@Module({
  providers: [TicketService],
  exports: [TicketService],
})
export class TicketModule {}
