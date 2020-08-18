export function trace(props, state, prevProps, prevState) {
  console.log('DidUpdate');
  Object.entries(props).forEach(([key, val]) =>
    prevProps[key] !== val && console.log(`Logger: Prop '${key}' changed. ${prevProps[key]} -> ${val}`)
  );
  if (state) {
    Object.entries(state).forEach(([key, val]) =>
      prevState[key] !== val && console.log(`Logger: State '${key}' changed. ${prevState[key]} -> ${val}`)
    );
  }
}
