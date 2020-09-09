import React from "react";
import { VirtualList } from "./VirtualList";

interface DebugInfoContainerProps<Item> {
  instance: VirtualList<Item>;
  enable?: boolean;
}

export class DebugInfoContainer<Item> extends React.Component<
  DebugInfoContainerProps<Item>,
  {}
> {
  render() {
    const { enable, instance } = this.props;

    if (!enable) {
      return null;
    }

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          position: "absolute",
          right: -instance.props.width,
          top: instance.props.height / 4,
          zIndex: 2,
          backgroundColor: "black",
          color: "white",
          width: 180,
        }}
      >
        <span>startIndexToRender: {instance.state.startIndexToRender}</span>
        <span>stopIndexToRender: {instance.state.stopIndexToRender}</span>
        <span>offset: {instance.offset}</span>
        <span>anchorIndex: {instance.anchorIndex}</span>
        <span>lastPositionedIndex: {instance.lastPositionedIndex}</span>
        <span>
          scrollingToIndex:{" "}
          {instance.scroller.scrollingToIndex && instance.scroller.scrollingToIndex}
        </span>
        <span>isScrolling: {instance.isScrolling ? "true" : "false"}</span>
        <span>inited: {instance.inited ? "true" : "false"}</span>
        <span>totalHeight: {instance.state.estimatedTotalHeight}</span>
        <span>isAtTheTop: {instance.offset === 0 ? "true" : "false"}</span>
        <span>
          isAtTheBottom:{" "}
          {instance.offset === instance.getMaximumPossibleOffset()
            ? "true"
            : "false"}
        </span>
      </div>
    );
  }
}
