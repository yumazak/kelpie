import { defineCollection } from 'astro:content';
import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders';
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';

export const collections = {
	docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
	// Starlight's UI strings: `src/content/i18n/ja.json` overrides its built-in
	// Japanese translations. Empty for now, but the file has to exist for the
	// locale config to be valid.
	i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
};
