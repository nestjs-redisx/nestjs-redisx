---
title: 'Recipes — Session Plugin | NestJS RedisX'
description: 'Production recipes: GitHub-style device page, log out everywhere else, seat limits, compliance lifetime cap, audit events, typed sessions.'
---

# Recipes

## GitHub-Style Device Page

List every signed-in device with browser, IP, and activity — mark the current one:

<<< @/apps/demo/src/plugins/session/device-page.usage.ts{typescript}

Pair it with activity stamping so the IP / user-agent columns are populated:

<<< @/apps/demo/src/plugins/session/activity-stamping.setup.ts{typescript}

## Log Out Everywhere (Else)

The security page button, the password-change hook, and the support tool:

<<< @/apps/demo/src/plugins/session/revoke-sessions.usage.ts{typescript}

## Seat Limits + Compliance Cap

Banking-grade policies in two options:

<<< @/apps/demo/src/plugins/session/security-policies.setup.ts{typescript}

## Audit Trail

<<< @/apps/demo/src/plugins/session/audit-events.setup.ts{typescript}

## Typed Sessions

<<< @/apps/demo/src/plugins/session/typed-sessions.usage.ts{typescript}

## OIDC Back-Channel Logout

The plugin makes back-channel logout implementable in a few lines: the IdP's `backchannel_logout` request carries the user (`sub`) — resolve it and call `revokeAll(sub)`. No session enumeration, no custom index.

```typescript
@Post('backchannel-logout')
async backchannelLogout(@Body() body: { logout_token: string }) {
  const { sub } = await this.oidc.verifyLogoutToken(body.logout_token);
  await this.sessions.revokeAll(sub);
  return {};
}
```
