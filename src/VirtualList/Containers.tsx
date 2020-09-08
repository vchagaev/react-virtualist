import { DebugInfoContainer } from "./DebugInfoContainer";
import React, { ReactNodeArray, UIEvent } from "react";
import throttle from "lodash-es/throttle";
import { Row } from "./Row";
import { VirtualList } from "./VirtualList";

const SCROLL_THROTTLE_MS = 100;

interface ContainersProps<Item> {
  height: number;
  width: number;
  estimatedTotalHeight: number;
  rows: ReactNodeArray;
  onScroll: (normalizedScrollTop: number) => void;
  debug: boolean;
  reversed: boolean;
  containerRef: React.Ref<HTMLDivElement>;
  instance: VirtualList<Item>;
  scrollThrottle: number;
}

export class Containers<Item> extends React.PureComponent<
  ContainersProps<Item>
> {
  onScrollThrottled = throttle((scrollTop: number) => {
    const { onScroll } = this.props;

    const normalizedScrollTop = Math.max(0, Math.round(scrollTop)); // for safari inertia scroll

    onScroll(normalizedScrollTop);
  }, this.props.scrollThrottle);

  onScroll = (event: UIEvent) => {
    this.onScrollThrottled(event.currentTarget.scrollTop);
  };

  render() {
    const {
      height,
      debug,
      width,
      rows,
      estimatedTotalHeight,
      reversed,
      containerRef,
      instance,
    } = this.props;

    let curHeight = height;
    let curOverflow = "auto";
    if (reversed && estimatedTotalHeight < height) {
      curHeight = estimatedTotalHeight;
      curOverflow = "none";
    }

    return (
      <div
        style={{
          height,
          position: "relative",
        }}
      >
        <DebugInfoContainer<Item> instance={instance} enable={debug} />
        <div
          style={{
            width,
            height: curHeight,
            overflow: curOverflow,
            WebkitOverflowScrolling: "touch",
            willChange: "transform",
            position: "absolute",
            bottom: reversed ? 0 : undefined,
            overflowAnchor: "none",
          }}
          onScroll={this.onScroll}
          ref={containerRef}
        >
          <div
            style={{
              height: estimatedTotalHeight,
              width: "100%",
              position: "relative",
            }}
          >
            {rows}
          </div>
        </div>
      </div>
    );
  }
}
