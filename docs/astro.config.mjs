// @ts-check
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

import { base, site } from './site.config.mjs';

export default defineConfig({
	site,
	base,
	integrations: [
		starlight({
			title: 'kelpie',
			description:
				'opencode のサーバを、Tailscale 越しにスマホのチャットアプリとして操作する。',
			// The site is Japanese, so `root` is the Japanese locale: pages stay
			// directly in `src/content/docs/`, with no language directory.
			defaultLocale: 'root',
			locales: { root: { label: '日本語', lang: 'ja' } },
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
			// Generated pages override this with the root file they came from.
			editLink: {
				baseUrl: 'https://github.com/yumazak/kelpie/edit/main/docs/',
			},
			lastUpdated: true,
			sidebar: [
				{ label: 'はじめに', items: ['guide'] },
				{ label: '設計', items: ['design'] },
			],
		}),
	],
});
