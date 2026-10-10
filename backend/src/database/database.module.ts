import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config } from '../config/config.js';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: config.database.url,
      // gen_random_uuid() is built into Postgres 13+; avoids needing uuid-ossp
      uuidExtension: 'pgcrypto',
      // picks up every entity registered via TypeOrmModule.forFeature()
      autoLoadEntities: true,
      // auto-creates/updates tables from entities; dev only, use migrations in production
      synchronize: config.env !== 'production',
    }),
  ],
})
export class DatabaseModule {}
