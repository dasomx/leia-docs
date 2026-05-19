import { source } from './src/lib/source';

console.log(source.getPages().map(p => p.url));
