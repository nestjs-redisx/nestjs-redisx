import { Injectable, Controller, Post, Body, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Idempotent } from '@nestjs-redisx/idempotency';
import { RegisterDto, UserService, TokenService, EmailService, SettingsService, AnalyticsService } from '../types';

@Injectable()
@Controller()
export class AuthController {
  constructor(
    private readonly userService: UserService,
    private readonly tokenService: TokenService,
    private readonly emailService: EmailService,
    private readonly settingsService: SettingsService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  @Post('register')
  @Idempotent({
    ttl: 3600,
    keyExtractor: (ctx) => {
      const req = ctx.switchToHttp().getRequest();
      // Use email as key (natural idempotency)
      return `register-${req.body.email}`;
    },
  })
  async register(@Body() dto: RegisterDto) {
    // Check if email already exists
    const existing = await this.userService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    // Create user
    const user = await this.userService.create({
      email: dto.email,
      password: await this.hashPassword(dto.password),
      name: dto.name,
    });

    // Send verification email
    const token = await this.tokenService.generateVerification(user);
    await this.emailService.sendVerification(user.email, token);

    // Create default settings
    await this.settingsService.createDefaults(user.id);

    // Track signup
    await this.analyticsService.trackSignup(user);

    return {
      id: user.id,
      email: user.email,
      message: 'Verification email sent',
    };
  }

  private async hashPassword(password: string): Promise<string> {
    return createHash('sha256').update(password).digest('hex');
  }
}
