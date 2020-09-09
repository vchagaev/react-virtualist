VirtualList can virtualize huge lists with dynamic height.
It anchors to the top element in the current view. It uses ResizeObserver for detecting changes in heights.
Inspired by react-window.

There are some caveats except described in related issues. Items from props may be applied with delay.
They are applied only when scroll is idle. This is the limitation of the correction technique that is used here.
This technique relies on consistent indexes to calculate corrected offsets.
scrollTo - is async function because we measure items on the fly.

Related issues and discussions:

- https://github.com/bvaughn/react-window/issues/6
- https://github.com/bvaughn/react-virtualized/issues/610#issuecomment-324890558

TODO:
- layout (offsets) Manager as a module
- support heuristic function getEstimatedHeight(item, width) for better layouting
- logging system
- tests
