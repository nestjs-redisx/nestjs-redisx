import { Injectable, Controller, Post, Body, Res, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Idempotent } from '@nestjs-redisx/idempotency';
import { CreateTransferDto, AccountService, TransferService, NotificationService, DatabaseTx, User } from '../types';

@Injectable()
@Controller()
export class TransferController {
  constructor(
    private readonly accountService: AccountService,
    private readonly transferService: TransferService,
    private readonly notificationService: NotificationService,
    private readonly db: DatabaseTx,
  ) {}

  @Post('transfers')
  @Idempotent({
    ttl: 86400,
    cacheHeaders: ['X-Transfer-Id', 'X-Transaction-Hash'],
  })
  async createTransfer(
    @Body() dto: CreateTransferDto,
    @Res() res: any,
  ) {
    // Validate accounts
    const fromAccount = await this.accountService.findOne(dto.fromAccountId);
    const toAccount = await this.accountService.findOne(dto.toAccountId);

    // Check balance
    if (fromAccount.balance < dto.amount) {
      throw new BadRequestException('Insufficient funds');
    }

    // Execute transfer (atomic)
    const transfer = await this.db.transaction(async (tx: any) => {
      // Debit from account
      await this.accountService.debit(
        dto.fromAccountId,
        dto.amount,
        { transaction: tx },
      );

      // Credit to account
      await this.accountService.credit(
        dto.toAccountId,
        dto.amount,
        { transaction: tx },
      );

      // Record transfer
      return await this.transferService.create(
        {
          fromAccountId: dto.fromAccountId,
          toAccountId: dto.toAccountId,
          amount: dto.amount,
          currency: dto.currency,
        },
        { transaction: tx },
      );
    });

    // Send notifications
    await Promise.all([
      this.notificationService.notifyTransferSent(fromAccount, transfer),
      this.notificationService.notifyTransferReceived(toAccount, transfer),
    ]);

    res.setHeader('X-Transfer-Id', transfer.id);
    res.setHeader('X-Transaction-Hash', transfer.hash);

    return res.status(201).json(transfer);
  }
}
