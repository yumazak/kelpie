/** Where and how the docs are published.
 *
 *  A GitHub Pages *project* page lives under the repository name, so every URL
 *  starts with `base`. This is the only place that knows it: `astro.config.mjs`
 *  reads it to configure the site, and the pages link to each other with
 *  `docsUrl()`.
 *
 *  Rename the repository → change `base`. Move to a custom domain → set `site`
 *  to it and drop `base` (and add `public/CNAME`). */
export const site = 'https://yumazak.github.io';
export const base = '/kelpie';

/** An absolute path to a page of this site: `docsUrl('design/')` → `/kelpie/design/`. */
export function docsUrl(path = '') {
	return `${base}/${path.replace(/^\/+/, '')}`;
}
