import { EachLabsProvider } from './eachlabs.js';
import { FalProvider } from './fal.js';
import type { Provider, ProviderFactoryOpts } from '../types.js';

export function makeProvider(opts: ProviderFactoryOpts): Provider {
  switch (opts.name) {
    case 'eachlabs':
      return new EachLabsProvider(opts.apiKey, opts.pro, opts.rateLimitRpm);
    case 'fal':
      return new FalProvider(opts.apiKey, opts.pro, opts.rateLimitRpm);
  }
}

export { EachLabsProvider, FalProvider };
