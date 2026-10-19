import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module.js';
import { PermissionModule } from '../permission/permission.module.js';
import { FeedbackController } from './feedback.controller.js';
import { FeedbackService } from './feedback.service.js';

/** "How was it?": asking the people who came, and showing organisers the answers. */
@Module({
  imports: [EmailModule, PermissionModule],
  controllers: [FeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
