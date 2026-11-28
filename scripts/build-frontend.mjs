// A developer shell may export NODE_ENV=development. Release assets must still
// use production React; set this before importing Vite or loading its plugins.
process.env.NODE_ENV = 'production';
const {build} = await import('vite');
await build();
