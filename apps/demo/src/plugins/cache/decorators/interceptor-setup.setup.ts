import { Module, Controller, UseInterceptors } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DeclarativeCacheInterceptor } from '@nestjs-redisx/cache';

// Option 1: Per-controller
@Controller('users')
@UseInterceptors(DeclarativeCacheInterceptor)
export class UserController {}

// Option 2: Global (in AppModule)
@Module({
  providers: [
    { provide: APP_INTERCEPTOR, useClass: DeclarativeCacheInterceptor },
  ],
})
export class AppModule {}
