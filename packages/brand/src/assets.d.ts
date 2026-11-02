// Vite serves an imported image as its URL string. The brand package is bundled by the renderer,
// which has no `vite/client` types of its own here, so the module shape is declared next to the
// files it covers.
declare module "*.png" {
  const url: string;
  export default url;
}
