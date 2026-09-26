// @ts-check
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

import { base, site } from './site.config.mjs';

export default defineConfig({
	site,
	base,
	// Locale URLs are directories, and sidebar/content links inside a locale are
	// relative to the current page, so the slash-less form must redirect: without
	// it, `/kelpie/ja` would render a page whose links point at `/kelpie/...`
	// (the English pages) instead of `/kelpie/ja/...`.
	trailingSlash: 'always',
	integrations: [
		starlight({
			title: 'kelpie',
			description:
				'Drive an opencode server from your phone as a chat app, over Tailscale.',
			// English is the root locale: its pages stay directly in
			// `src/content/docs/`, everything else lives in `src/content/docs/<locale>/`.
			// Adding a language means adding a directory and a line here.
			defaultLocale: 'root',
			locales: {
				root: { label: 'English', lang: 'en' },
				ja: { label: '日本語', lang: 'ja' },
			},
			logo: { src: './src/assets/kelpie.svg', alt: 'kelpie' },
			favicon: '/favicon.svg',
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/yumazak/kelpie',
				},
			],
			// Same typeface as the PWA (`web/src/index.css`).
			customCss: ['@fontsource-variable/geist', './src/styles/custom.css'],
			editLink: {
				baseUrl: 'https://github.com/yumazak/kelpie/edit/main/docs/',
			},
			lastUpdated: true,
			sidebar: [
				{ label: 'Guide', translations: { ja: '使い方' }, items: ['guide'] },
				{ label: 'Design', translations: { ja: '設計' }, items: ['design'] },
			],
		}),
	],
});
