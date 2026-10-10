import { Injectable, Inject } from '@nestjs/common';
import { DEDUP_SERVICE, IDedupService } from '@nestjs-redisx/dedup';
import { SearchIndex } from './types';

@Injectable()
export class IndexingService {
  constructor(
    @Inject(DEDUP_SERVICE)
    private readonly dedup: IDedupService,
    private readonly searchIndex: SearchIndex,
  ) {}

  // Trailing debounce ACROSS INSTANCES: a burst of product updates triggers
  // ONE rebuild, after the burst goes quiet for 30s, on the instance that
  // received the LAST update. Superseded calls resolve undefined.
  async onProductChanged(): Promise<void> {
    await this.dedup.debounce('reindex:products', () => this.searchIndex.rebuild(), { window: 30_000 });
  }
}
