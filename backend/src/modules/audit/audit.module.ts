import { Module } from '@nestjs/common';
import { OrganisationModule } from '../organisation/organisation.module.js';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

/** Reading the audit log. (Writing is the audit() function, inside each change's transaction.) */
@Module({
  imports: [OrganisationModule],
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
