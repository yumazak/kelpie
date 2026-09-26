# kelpie docs

The documentation site, published at <https://yumazak.github.io/kelpie/>.

```bash
pnpm install
pnpm dev              # http://localhost:4321/kelpie/
pnpm build && pnpm preview
```

## Layout

- `site.config.mjs` … the published URL and `/kelpie` base, in one place for
  `astro.config.mjs`
- `astro.config.mjs` … locales, sidebar, theme
- `src/content/docs/` … the source of truth for the site. English is the root
  locale, so its pages sit here directly:
  - `index.mdx` … landing page
  - `guide.md` … running it, CLI, the macOS service
  - `design.md` … why opencode only, and how the pieces fit
- `src/content/docs/<locale>/` … the same three file names, translated. Today:
  `ja/`. A missing page falls back to English with a notice.
- `src/styles/custom.css` … the only theming, beyond Starlight's defaults
- `src/content/i18n/ja.json` … overrides for Starlight's Japanese UI strings
  (empty: the built-in translations are in use)

## Adding a language

1. Add the locale to `locales` in `astro.config.mjs` (label, `lang`, and `dir`
   for right-to-left languages).
2. Create `src/content/docs/<locale>/` with the same file names as the English
   pages. Translate them one at a time — anything missing keeps showing English.
3. Add `translations: { <locale>: '…' }` to the sidebar labels.
4. If Starlight has no built-in UI translation for that language, add
   `src/content/i18n/<lang>.json` with the keys you want to override.

Deployment is `.github/workflows/docs.yml`, which builds this directory and
publishes it through GitHub Actions Pages (needs **Settings → Pages → Source:
GitHub Actions**).
