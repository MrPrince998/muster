import { Logger, Module } from '@nestjs/common';
import Stripe from 'stripe';
import { config } from '../../config/config.js';
import { EmailModule } from '../email/email.module.js';
import { OrganisationModule } from '../organisation/organisation.module.js';
import { PermissionModule } from '../permission/permission.module.js';
import { TicketModule } from '../ticket/ticket.module.js';
import { DisabledGateway, PaymentGateway, StripeGateway } from './payment-gateway.js';
import { PaymentController } from './payment.controller.js';
import { PaymentService } from './payment.service.js';

/** Paid tickets, through each workspace's own Stripe account. */
@Module({
  imports: [EmailModule, OrganisationModule, PermissionModule, TicketModule],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    {
      provide: PaymentGateway,
      useFactory: (): PaymentGateway => {
        const { stripeSecretKey, stripeWebhookSecret } = config.payments;
        if (!stripeSecretKey) {
          new Logger('Payments').warn('STRIPE_SECRET_KEY is not set: payments are off, events are free');
          return new DisabledGateway();
        }
        if (!stripeWebhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is required with STRIPE_SECRET_KEY');
        return new StripeGateway(new Stripe(stripeSecretKey), stripeWebhookSecret);
      },
    },
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
