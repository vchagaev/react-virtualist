import React, { UIEvent, useCallback, useRef } from "react";
import throttle from "lodash-es/throttle";
import Measure, { ContentRect } from "react-measure";
import debounce from "lodash-es/debounce";

function getFirstIndexDiffer(arr1: object[], arr2: object[]) {
  for (let i = 0; i < arr1.length; i++) {
    if (arr1[i] !== arr2[i]) {
      return i;
    }
  }

  return arr1.length;
}

interface RealListProps {
  containerWidth: number;
  containerHeight: number;
  totalHeight: number;
  onScroll: (scrollTop: number) => void;
}

const RealList: React.FC<RealListProps> = ({
  containerWidth,
  containerHeight,
  totalHeight,
  onScroll,
  children,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const onScrollThrottled = useCallback(throttle(onScroll, 100), [onScroll]);
  const onScrollHandler = useCallback(
    (event: UIEvent) => {
      onScrollThrottled(event.currentTarget.scrollTop);
    },
    [onScrollThrottled]
  );

  return (
    <div
      style={{
        width: containerWidth,
        height: containerHeight,
        position: "relative",
        overflow: "auto",
        WebkitOverflowScrolling: "touch",
        willChange: "transform",
      }}
      onScroll={onScrollHandler}
      ref={containerRef}
    >
      <div
        style={{
          height: totalHeight,
          width: "100%",
          position: "relative",
        }}
      >
        {children}
      </div>
    </div>
  );
};

interface VirtualListProps<Item extends Object> {
  items: Item[];
  height: number;
  width: number;
  getItemKey: (item: Item) => string;
  estimatedItemHeight: number;
  renderRow: (renderRowProps: RenderRowProps<Item>) => React.ReactNode;
  overscanCount: number;
  overscanFactor: number;
}

interface VirtualListState<Item extends Object> {
  offset: number;
}

interface RenderRowProps<Item> {
  item: Item;
  ref: React.Ref<HTMLDivElement>; // TODO: any dom node
}

type ItemMetadata = {
  height: number;
  offset: number;
  measured: boolean;
};

const DEFAULT_ESTIMATED_HEIGHT = 50;
const DEFAULT_OVERSCAN_FACTOR = 2;

export class VirtualList<Item extends Object> extends React.PureComponent<
  VirtualListProps<Item>,
  VirtualListState<Item>
> {
  static defaultProps = {
    overscanCount: 1,
    estimatedItemHeight: DEFAULT_ESTIMATED_HEIGHT,
    overscanFactor: DEFAULT_OVERSCAN_FACTOR,
  };

  state = {
    offset: 0,
  };

  lastPositionedIndex: number = 0;
  itemToMetadata: WeakMap<Item, ItemMetadata> = new WeakMap<
    Item,
    ItemMetadata
  >();

  setItemMetadata = (item: Item, newMeta: Partial<ItemMetadata>) => {
    const { estimatedItemHeight } = this.props;

    if (!this.itemToMetadata.has(item)) {
      this.itemToMetadata.set(item, {
        height: estimatedItemHeight,
        offset: 0,
        measured: false,
      });
    }

    const meta = this.itemToMetadata.get(item)!;

    this.itemToMetadata.set(item, { ...meta, ...newMeta });
  };

  getItemMetadata = (item: Item) => {
    const { estimatedItemHeight } = this.props;

    if (!this.itemToMetadata.has(item)) {
      this.itemToMetadata.set(item, {
        height: estimatedItemHeight,
        offset: 0,
        measured: false,
      });
    }

    return this.itemToMetadata.get(item)!;
  };

  buildOffsetsForCurrentViewAndSetLastPositionedItemIndex = (
    props: VirtualListProps<Item>,
    state: VirtualListState<Item>
  ) => {
    const { items, height, overscanCount, overscanFactor } = props;
    const { offset } = state;

    if (this.lastPositionedIndex >= items.length - 1) {
      return;
    }

    const lastPositionedItem = items[this.lastPositionedIndex];
    const lastPositionedItemMetadata = this.getItemMetadata(lastPositionedItem);
    const targetOffset = offset + height * overscanFactor;

    // TODO: count overscanCount
    if (lastPositionedItemMetadata.offset > targetOffset) {
      return;
    }

    let startIndex = this.lastPositionedIndex;
    let startItemMetadata = lastPositionedItemMetadata;

    let curOffset = startItemMetadata.offset + startItemMetadata.height;
    let stopIndex = startIndex;
    let overscannedItems = 0;

    while (
      (curOffset < targetOffset || overscannedItems < overscanCount) &&
      stopIndex < items.length - 1
    ) {
      if (curOffset >= targetOffset) {
        overscannedItems++;
      }

      stopIndex++;
      const curItem = items[stopIndex];
      this.setItemMetadata(curItem, { offset: curOffset });
      curOffset += this.getItemMetadata(curItem).height;
    }

    console.log("built offsets", {
      startIndex,
      stopIndex,
    });

    this.lastPositionedIndex = stopIndex;
  };

  // TODO: realScrollTop to ref
  onScroll = (realScrollTop: number) => {
    this.setState({
      offset: realScrollTop,
    });
  };

  // TODO: lower and upper bound?
  findNearestItemBinarySearch = (low: number, high: number, offset: number) => {
    const { items } = this.props;

    while (low <= high) {
      const middle = low + Math.floor((high - low) / 2);
      const currentOffset = this.getItemMetadata(items[middle]).offset;

      if (currentOffset === offset) {
        return middle;
      } else if (currentOffset < offset) {
        low = middle + 1;
      } else if (currentOffset > offset) {
        high = middle - 1;
      }
    }

    if (low > 0) {
      return low - 1;
    } else {
      return 0;
    }
  };

  getStartIndex = () => {
    const { offset } = this.state;

    this.buildOffsetsForCurrentViewAndSetLastPositionedItemIndex(
      this.props,
      this.state
    );

    return this.findNearestItemBinarySearch(
      0,
      this.lastPositionedIndex,
      offset
    );
  };

  // TODO: binary search too and offsets ahead instead of simple overscan
  getStopIndex = (startIndex: number) => {
    const { items, height } = this.props;
    const { offset } = this.state;

    const startItem = items[startIndex];
    const itemMetadata = this.getItemMetadata(startItem);
    const maxOffset = offset + height;

    let curOffset = itemMetadata.offset + itemMetadata.height;
    let stopIndex = startIndex;

    while (stopIndex < items.length - 1 && curOffset < maxOffset) {
      stopIndex++;
      curOffset += this.getItemMetadata(items[stopIndex]).height;
    }

    return stopIndex;
  };

  getStartAndStopIndex = () => {
    const { items, overscanCount } = this.props;

    if (items.length === 0) {
      return [0, -1, 0, -1];
    }

    const startIndex = this.getStartIndex();
    const stopIndex = this.getStopIndex(startIndex);

    // TODO: overscan with scroll direction
    return [
      Math.max(0, startIndex - overscanCount),
      Math.max(0, Math.min(items.length - 1, stopIndex + overscanCount)),
      startIndex,
      stopIndex,
    ];
  };

  componentDidUpdate(
    prevProps: Readonly<VirtualListProps<Item>>,
    prevState: Readonly<VirtualListState<Item>>,
    snapshot?: any
  ): void {
    const { items } = this.props;
    const { items: prevItems } = prevProps;

    if (items !== prevItems) {
      this.lastPositionedIndex = Math.min(
        this.lastPositionedIndex,
        getFirstIndexDiffer(items, prevItems) - 1
      );

      this.forceUpdate();
    }
  }

  forceUpdateDebounced = debounce(() => {
    this.forceUpdate();
  }, 1);

  // TODO: check out of order and inconsistency between state items and index
  onResize = (index: number) => (contentRect: ContentRect) => {
    const { items } = this.props;

    const item = items[index];
    const metadata = this.getItemMetadata(item);
    const newHeight = contentRect.offset ? contentRect.offset.height : 0;
    const oldHeight = metadata.height;

    if (newHeight === oldHeight) {
      return;
    }

    this.setItemMetadata(item, { height: newHeight, measured: true });

    this.lastPositionedIndex = Math.min(
      this.lastPositionedIndex,
      Math.max(0, index - 1)
    );

    this.forceUpdateDebounced();
  };

  getEstimatedTotalHeight = () => {
    const { items, estimatedItemHeight } = this.props;

    if (items.length === 0) {
      return 0;
    }

    const lastPositionedItemMetadata = this.getItemMetadata(
      items[this.lastPositionedIndex]
    );

    return (
      lastPositionedItemMetadata.offset +
      lastPositionedItemMetadata.height +
      (items.length - 1 - this.lastPositionedIndex) * estimatedItemHeight
    );
  };

  render() {
    const { items, height, width, renderRow, getItemKey } = this.props;

    const [startIndex, stopIndex] = this.getStartAndStopIndex();
    const estimatedTotalHeight = this.getEstimatedTotalHeight();

    console.log({ startIndex, stopIndex });

    const itemsToRender: React.ReactNode[] = [];
    for (let i = startIndex; i <= stopIndex; i++) {
      const item = items[i];
      const { offset, height, measured } = this.getItemMetadata(item);

      itemsToRender.push(
        <Measure key={getItemKey(item)} offset onResize={this.onResize(i)}>
          {({ measureRef }) => (
            <div
              // TODO: cache for styles?
              style={{
                position: "absolute",
                top: offset,
                height,
                opacity: measured ? 1 : 0,
                width: "100%",
              }}
            >
              {renderRow({
                ref: measureRef,
                item,
              })}
            </div>
          )}
        </Measure>
      );
    }

    return (
      <RealList
        containerHeight={height}
        containerWidth={width}
        totalHeight={estimatedTotalHeight}
        onScroll={this.onScroll}
      >
        {itemsToRender}
      </RealList>
    );
  }
}
