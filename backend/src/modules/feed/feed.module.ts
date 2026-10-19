import { Module } from '@nestjs/common';
import { FeedController } from './feed.controller.js';
import { FeedService } from './feed.service.js';

/** Calendar feeds: clubs' events for calendar apps to subscribe to. */
@Module({
  controllers: [FeedController],
  providers: [FeedService],
})
export class FeedModule {}
