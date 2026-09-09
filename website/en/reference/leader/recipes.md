---
title: 'Recipes — Leader Election Plugin | NestJS RedisX'
description: 'Leader election patterns: singleton crons, run-once startup work, maintenance drains, spreading singleton workloads across groups, and fencing with locks.'
---

# Recipes

## Singleton Cron Across the Fleet

The canonical use case — schedule everywhere, execute once:

<<< @/apps/demo/src/plugins/leader/leader-only-cron.usage.ts{typescript}

## Run-Once Startup Work

Warmups or maintenance tasks that should run on **at most one** instance when a group starts leaderless (fresh deploy, scale-from-zero, disaster recovery):

```typescript
@Injectable()
export class StartupTasks implements OnApplicationBootstrap {
  constructor(@Inject(LEADER_SERVICE) private readonly leader: ILeaderService) {}

  async onApplicationBootstrap() {
    // The first election round completes during module init, so this is
    // already meaningful here.
    await this.leader.runIfLeader(() => this.warmCaches());
  }

  private async warmCaches() {
    /* ... */
  }
}
```

::: warning At most once — and usually ZERO times in a rolling update
`onApplicationBootstrap` fires once per process, and during a rolling update the lease is normally still held by an old pod when each new pod boots — every new pod evaluates `runIfLeader` as a follower and skips, and when the old leader finally exits, the seat goes to an instance whose hook already ran. For work that must run **once per rollout/version**, don't gate it on leadership: make it idempotent and key it by version (e.g. `@WithLock` + a `done:{version}` marker), or run it in your deploy/migration step. "Leader runs the migration" is a scheduling convenience, not a safety proof — during rollouts old and new versions briefly coexist; make the migration itself idempotent, or wrap it with [@WithLock](../locks/) / track applied versions.
:::

## Maintenance Drain

Hand leadership over before restarting a node:

<<< @/apps/demo/src/plugins/leader/step-down.usage.ts{typescript}

## Spreading Singleton Workloads

Different groups elect independently — heavy singleton jobs can land on different instances:

```typescript
@Cron(CronExpression.EVERY_HOUR)
@LeaderOnly({ group: 'reports' })
async buildReports() {}

@Cron(CronExpression.EVERY_10_MINUTES)
@LeaderOnly({ group: 'reindex' })
async reindexSearch() {}
```

## Fencing Critical Sections

Election chooses who starts work; a lock guarantees exclusivity inside it:

```typescript
@Cron(CronExpression.EVERY_5_MINUTES)
@LeaderOnly()
@WithLock({ key: 'billing:charge-run', ttl: 240_000 })
async chargeRun() {
  // Never overlaps, even across a leadership handover with work in flight
}
```

## Leadership-Aware Health Output

Expose who leads for dashboards and on-call debugging:

<<< @/apps/demo/src/plugins/leader/service-status.usage.ts{typescript}

## Next Steps

- [Failover](./failover) — what happens during handovers
- [Troubleshooting](./troubleshooting) — when a job doesn't run
