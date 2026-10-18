import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config } from '../config/config.js';
import { TenantService } from './tenant.service.js';

// global so every module can inject TenantService without importing this one
@Global()
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      // the limited app role: no DDL, and subject to RLS
      url: config.database.url,
      // picks up every entity registered via TypeOrmModule.forFeature()
      autoLoadEntities: true,
      // the schema comes only from migrations (pnpm migration:run), which also
      // create the RLS policies and database roles that entities cannot express
      synchronize: false,
      // the app role cannot create extensions, and none are needed
      installExtensions: false,
    }),
  ],
  providers: [TenantService],
  exports: [TenantService],
})
export class DatabaseModule {}
