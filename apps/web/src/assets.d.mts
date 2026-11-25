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
