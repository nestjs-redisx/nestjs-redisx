import { Injectable, Inject, ConflictException } from '@nestjs/common';
import { TRACING_SERVICE, ITracingService } from '@nestjs-redisx/tracing';
import { RegisterDto, User, UserRepository, CacheStore, EmailService } from '../types';

@Injectable()
export class AuthService {
  constructor(
    @Inject(TRACING_SERVICE) private readonly tracing: ITracingService,
    private readonly userRepo: UserRepository,
    private readonly cache: CacheStore,
    private readonly emailService: EmailService,
  ) {}

  async register(dto: RegisterDto): Promise<User> {
    return this.tracing.withSpan('user.register', async () => {
      this.tracing.setAttribute('user.email', dto.email);

      // Check if user exists
      const existingUser = await this.tracing.withSpan(
        'user.check_exists',
        async () => {
          this.tracing.addEvent('cache.lookup');
          const cached = await this.cache.get(`user:${dto.email}`);

          if (cached) {
            this.tracing.setAttribute('cache.hit', true);
            return cached;
          }

          this.tracing.setAttribute('cache.hit', false);
          this.tracing.addEvent('db.query');
          return this.userRepo.findByEmail(dto.email);
        },
      );

      if (existingUser) {
        this.tracing.addEvent('user.already_exists');
        throw new ConflictException('User already exists');
      }

      // Hash password
      const hashedPassword = await this.tracing.withSpan(
        'password.hash',
        async () => {
          this.tracing.setAttribute('hash.algorithm', 'bcrypt');
          this.tracing.setAttribute('hash.rounds', 10);
          return `hashed_${dto.password}`;
        },
      );

      // Create user
      const user = await this.tracing.withSpan('user.create', async () => {
        this.tracing.addEvent('db.insert');
        return this.userRepo.create({
          email: dto.email,
          password: hashedPassword,
        });
      });

      // Send welcome email
      await this.tracing.withSpan('email.send_welcome', async () => {
        this.tracing.setAttribute('email.to', user.email);
        this.tracing.setAttribute('email.template', 'welcome');
        await this.emailService.sendWelcome(user.email);
        this.tracing.addEvent('email.sent');
      });

      return user;
    });
  }
}
