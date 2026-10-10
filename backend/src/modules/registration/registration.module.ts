import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Registration } from './entities/registration.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Registration])],
})
export class RegistrationModule {}
