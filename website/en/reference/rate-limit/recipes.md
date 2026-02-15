---
title: Recipes
description: Real-world rate limiting patterns and examples
---

# Recipes

Common use cases and production patterns.

## 1. Login Protection

Prevent brute force attacks:

```typescript
@Injectable()
export class AuthController {
  @Post('login')
  @RateLimit({
    key: (ctx) => {
      const req = ctx.switchToHttp().getRequest();
      return `login:${req.body.email}`;
    },
    points: 5,
    duration: 900,  // 5 attempts per 15 minutes
    message: 'Too many login attempts. Try again in 15 minutes.',
  })
  async login(@Body() dto: LoginDto) {
    const user = await this.authService.validateUser(dto.email, dto.password);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.authService.login(user);
  }

  @Post('reset-password')
  @RateLimit({
    key: 'global:reset-password',
    points: 10,
    duration: 3600,  // 10 resets per hour globally
  })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.sendResetEmail(dto.email);
  }
}
```

## 2. API Tiered Limits

Different limits for different subscription tiers using the Service API:

<<< @/apps/demo/src/plugins/rate-limit/recipes/tiered-limits.usage.ts{typescript}

## 3. Webhook Rate Limiting

Protect webhook endpoints:

<<< @/apps/demo/src/plugins/rate-limit/recipes/webhook.usage.ts{typescript}

## 4. File Upload Limits

Control upload frequency:

```typescript
@Controller('files')
export class FileController {
  @Post('upload')
  @RateLimit({
    key: 'user',
    algorithm: 'token-bucket',
    points: 10,        // 10 concurrent uploads
    refillRate: 0.5,   // 1 upload every 2 seconds
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    return this.fileService.save(file, req.user.id);
  }

  @Post('bulk-upload')
  @RateLimit({
    key: 'user',
    points: 3,
    duration: 3600,  // 3 bulk uploads per hour
    message: 'Bulk upload limited to 3 per hour',
  })
  async bulkUpload(
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: any,
  ) {
    return this.fileService.bulkSave(files, req.user.id);
  }
}
```

## 5. GraphQL Rate Limiting

Rate limit GraphQL queries:

```typescript
import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { RateLimitGuard } from '@nestjs-redisx/rate-limit';

@Resolver(() => User)
@UseGuards(RateLimitGuard)
export class UserResolver {
  // Read operations: generous limit
  @Query(() => [User])
  @RateLimit({ key: 'user', points: 1000, duration: 60 })
  async users() {
    return this.userService.findAll();
  }

  // Expensive operations: strict limit
  @Query(() => UserAnalytics)
  @RateLimit({ key: 'user', points: 10, duration: 3600 })
  async userAnalytics(@Args('userId') userId: string) {
    return this.analyticsService.generate(userId);
  }

  // Mutations: moderate limit
  @Mutation(() => User)
  @RateLimit({ key: 'user', points: 100, duration: 60 })
  async updateUser(@Args('input') input: UpdateUserInput) {
    return this.userService.update(input);
  }
}
```

### Query Complexity Based Limiting

```typescript
@Injectable()
export class ComplexityBasedRateLimiter {
  async checkComplexity(query: string, userId: string): Promise<boolean> {
    const complexity = this.calculateComplexity(query);

    const result = await this.rateLimitService.check(`user:${userId}`, {
      points: Math.ceil(complexity),  // Consume points based on complexity
      duration: 60,
    });

    return result.allowed;
  }

  private calculateComplexity(query: string): number {
    // Calculate query complexity based on depth, fields, etc.
    return 1;
  }
}
```

## 6. Multi-Layer Protection

Combine global and per-user limits:

```typescript
@Controller('api')
@RateLimit({
  key: 'global:api',
  points: 10000,
  duration: 60,  // Global cap: 10K requests per minute
})
export class ApiController {
  @Get('data')
  @RateLimit({ key: 'ip', points: 100, duration: 60 })    // Per-IP: 100/min
  @RateLimit({ key: 'user', points: 50, duration: 60 })   // Per-user: 50/min
  getData() {
    // Must pass all three limits
    return { data: 'value' };
  }

  @Get('expensive')
  @RateLimit({ key: 'user', points: 5, duration: 60 })
  @RateLimit({ key: 'global:expensive', points: 50, duration: 60 })
  expensiveOperation() {
    return { result: 'computed' };
  }
}
```

## 7. Burst Protection

Allow initial burst, then throttle:

```typescript
@Post('process')
@RateLimit({
  algorithm: 'token-bucket',
  points: 50,        // Allow burst of 50
  refillRate: 5,     // Then 5 per second sustained
  key: 'user',
})
async processData(@Body() data: any) {
  return this.processor.process(data);
}
```

## 8. Time-Based Limits

Different limits for different times using the Service API:

<<< @/apps/demo/src/plugins/rate-limit/recipes/time-based.usage.ts{typescript}

## 9. Progressive Rate Limiting

Increase limits as user trust grows using the Service API:

<<< @/apps/demo/src/plugins/rate-limit/recipes/progressive.usage.ts{typescript}

## 10. Organization-Wide Limits

Limit entire organizations:

<<< @/apps/demo/src/plugins/rate-limit/recipes/organization.usage.ts{typescript}

## Next Steps

- [Troubleshooting](./troubleshooting) — Debug issues
- [Overview](./index) — Back to overview
