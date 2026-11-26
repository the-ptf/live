declare module "*.html" {
  const text: string;
  export default text;
}
declare module "*.txt" {
  const text: string;
  export default text;
}
declare module "*.bin" {
  const bytes: ArrayBuffer;
  export default bytes;
}
declare module "*.svg" {
  const text: string;
  export default text;
}
declare module "*.png" {
  const bytes: ArrayBuffer;
  export default bytes;
}
