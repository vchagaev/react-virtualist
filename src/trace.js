export function trace(props, state, prevProps, prevState) {
  let reasons = [];

  Object.entries(props).forEach(
    ([key, val]) =>
      prevProps[key] !== val &&
      reasons.push(`    Prop '${key}' changed. ${prevProps[key]} -> ${val}`)
  );
  if (state) {
    Object.entries(state).forEach(
      ([key, val]) =>
        prevState[key] !== val &&
        reasons.push(`    State '${key}' changed. ${prevState[key]} -> ${val}`)
    );
  }

  console.log(
    "Logger: DidUpdate because:\n",
    reasons.length === 0 ? "force update" : reasons.join("\n")
  );
}
