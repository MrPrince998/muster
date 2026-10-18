import { PasswordHasher } from '@nestjs/authentication';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserService } from './user.service.js';
import { UserController } from './user.controller.js';
import { User } from './entities/user.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UserController],
  providers: [
    UserService,
    // scrypt with the library's default cost (ln=17); stored hashes record
    // their parameters, so raising the cost later only needs needsRehash().
    // Provided here (auth imports this module) so both share one instance.
    { provide: PasswordHasher, useValue: new PasswordHasher() },
  ],
  exports: [UserService, PasswordHasher],
})
export class UserModule {}
