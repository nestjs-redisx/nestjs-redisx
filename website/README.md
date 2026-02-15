# NestJS RedisX Documentation Website

VitePress-based documentation site for NestJS RedisX.

## Local Development

```bash
# From project root
npm run docs:dev

# Or from website directory
cd website
npm run dev
```

The site will be available at `http://localhost:5173/en/`

## Build for Production

```bash
# From project root
npm run docs:build

# Preview production build
npm run docs:preview
```

## Structure

```
website/
├── .vitepress/
│   ├── config.ts           # VitePress configuration
│   └── theme/
│       ├── index.ts        # Custom theme
│       └── custom.css      # Redis Red branding
├── public/
│   ├── logo.svg            # RedisX logo
│   └── images/             # Image assets
├── en/                     # English docs
│   ├── index.md            # Landing page
│   ├── guide/              # Getting started guides
│   │   ├── index.md
│   │   ├── installation.md
│   │   └── quick-start.md
│   └── plugins/            # Plugin documentation
│       ├── index.md
│       └── cache/
│           └── index.md
└── package.json
```

## Adding Content

### New Guide Page

1. Create file in `en/guide/`
2. Add to sidebar in `.vitepress/config.ts`

### New Plugin Page

1. Create directory in `en/plugins/{plugin-name}/`
2. Add `index.md`
3. Update sidebar in `.vitepress/config.ts`

## Markdown Features

### Code Blocks

```typescript
@Injectable()
export class UserService {
  @Cached({ key: 'user:{0}', ttl: 300 })
  async getUser(id: string) {
    return this.db.findUser(id);
  }
}
```

### Custom Containers

```markdown
::: tip Pro Tip
Use L1+L2 caching for optimal performance
:::

::: warning Important
Always set appropriate TTL values
:::

::: danger Critical
Never cache sensitive data without encryption
:::
```

### Mermaid Diagrams

```markdown
\`\`\`mermaid
graph TB
    A[Client] --> B[Cache]
    B --> C[Redis]
\`\`\`
```

## Theme Customization

Brand colors (Redis Red) are defined in `.vitepress/theme/custom.css`:

- Primary: `#DC382D`
- Hover: `#B91C1C`
- Light: `#FF6B6B`

## Deployment

Build and deploy to GitHub Pages, Vercel, Netlify, or any static hosting:

```bash
npm run docs:build
# Output: website/.vitepress/dist
```
