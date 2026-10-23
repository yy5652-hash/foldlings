// Dev-only: evaluate an expression in the running app frame (iwsdk browser run).
export default async function ({ frame }) {
  const expr = process.env.FOLD_EVAL ?? 'null';
  return await frame.evaluate((src) => {
    // eslint-disable-next-line no-new-func
    return new Function(`return (${src});`)();
  }, expr);
}
