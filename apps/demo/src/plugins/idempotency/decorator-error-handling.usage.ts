import { Controller, Post, Body, Catch, ArgumentsHost } from '@nestjs/common';
import { ExceptionFilter } from '@nestjs/common';
import { Idempotent, IdempotencyError, IdempotencyFingerprintMismatchError, IdempotencyTimeoutError } from '@nestjs-redisx/idempotency';
import { PaymentDto, PaymentService } from './types';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post()
  @Idempotent()
  async createPayment(@Body() dto: PaymentDto) {
    // If this throws, error is stored
    // Duplicate requests will get same error
    return this.paymentService.process(dto);
  }
}

// Exception filter for idempotency errors
@Catch(IdempotencyError)
export class IdempotencyFilter implements ExceptionFilter {
  catch(exception: IdempotencyError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();

    if (exception instanceof IdempotencyFingerprintMismatchError) {
      return response.status(422).json({
        error: 'Idempotency key reused with different request',
      });
    }

    if (exception instanceof IdempotencyTimeoutError) {
      return response.status(408).json({
        error: 'Timeout waiting for concurrent request',
      });
    }

    return response.status(500).json({
      error: 'Idempotency error',
    });
  }
}
