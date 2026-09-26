import type { APIRoute } from 'astro';

import { base } from '../../site.config.mjs';

/**
 * The docs' web app manifest.
 *
 * Generated rather than kept as a static file in `public/` so that `base` is
 * still spelled in exactly one place (`site.config.mjs`); a checked-in manifest
 * would be a second copy of it, and the one that silently breaks when the
 * repository is renamed.
 */
export const GET: APIRoute = () => {
	const url = (path: string) => `${base}/${path}`;

	return new Response(
		JSON.stringify(
			{
				name: 'kelpie docs',
				short_name: 'docs',
				description: 'kelpie のドキュメント。',
				lang: 'ja',
				dir: 'ltr',
				id: `${base}/`,
				start_url: `${base}/`,
				scope: `${base}/`,
				display: 'standalone',
				background_color: '#0b0b0d',
				theme_color: '#0b0b0d',
				icons: [
					{
						src: url('web-app-manifest-192x192.png'),
						sizes: '192x192',
						type: 'image/png',
					},
					{
						src: url('web-app-manifest-512x512.png'),
						sizes: '512x512',
						type: 'image/png',
					},
				],
			},
			null,
			'\t',
		),
		{ headers: { 'content-type': 'application/manifest+json' } },
	);
};
