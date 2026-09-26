# kelpie docs

The documentation site, published at <https://yumazak.github.io/kelpie/>.

```bash
pnpm install
pnpm dev              # http://localhost:4321/kelpie/
pnpm build && pnpm preview
```

## Layout

- `site.config.mjs` … the published URL and `/kelpie` base, in one place for
  `astro.config.mjs` and the pages
- `astro.config.mjs` … locale, sidebar, theme
- `src/content/docs/` … the source of truth for the site: `index.mdx` (landing),
  `guide.md` (使い方), `design.md` (設計)
- `src/styles/custom.css` … the only theming, beyond Starlight's defaults
- `src/content/i18n/ja.json` … overrides for Starlight's Japanese UI strings
  (empty: the built-in translations are in use)

Deployment is `.github/workflows/docs.yml`, which builds this directory and
publishes it through GitHub Actions Pages (needs **Settings → Pages → Source:
GitHub Actions**).
