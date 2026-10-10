import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller.js';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserService } from './user.service.js';
import { User } from './entities/user.entity.js';

describe('UserController', () => {
  let controller: UserController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [UserService, { provide: getRepositoryToken(User), useValue: {} }],
    }).compile();

    controller = module.get<UserController>(UserController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
