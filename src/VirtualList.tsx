import React, { UIEvent } from "react";
import throttle from "lodash-es/throttle";
import Measure, { ContentRect } from "react-measure";
import debounce from "lodash-es/debounce";

// TODO: overscan factor for both directions
// TODO: check overscans

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(() => resolve(), ms);
  });

function getFirstIndexDiffer(arr1: object[], arr2: object[]) {
  for (let i = 0; i < arr1.length; i++) {
    if (arr1[i] !== arr2[i]) {
      return i;
    }
  }

  return arr1.length;
}

interface VirtualListProps<Item extends Object> {
  items: Item[];
  height: number;
  width: number;
  getItemKey: (item: Item) => string;
  estimatedItemHeight: number;
  renderRow: (renderRowProps: RenderRowProps<Item>) => React.ReactNode;
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
  innerContainerRef = React.createRef<HTMLDivElement>();
  outerContainerRef = React.createRef<HTMLDivElement>();
  indexToFocus: number | null = null;
  scrollTopDelta: number = 0;

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

  /**
   * Build offsets for current view or needed index
   */
  buildOffsets = (
    props: VirtualListProps<Item>,
    state: VirtualListState<Item>
  ) => {
    const { items, height, overscanFactor } = props;
    const { offset } = state;
    const indexNeeded = this.indexToFocus;

    if (
      this.lastPositionedIndex >= items.length - 1 ||
      (indexNeeded !== null && this.lastPositionedIndex >= indexNeeded)
    ) {
      return;
    }

    const lastPositionedItem = items[this.lastPositionedIndex];
    const lastPositionedItemMetadata = this.getItemMetadata(lastPositionedItem);
    const targetOffset = offset + height * overscanFactor;

    // TODO: delta count here

    if (
      lastPositionedItemMetadata.offset > targetOffset &&
      indexNeeded === null
    ) {
      return;
    }

    let startIndex = this.lastPositionedIndex;
    let startItemMetadata = lastPositionedItemMetadata;

    let curOffset = startItemMetadata.offset + startItemMetadata.height;
    let stopIndex = startIndex;

    while (
      (curOffset < targetOffset ||
        (indexNeeded !== null && stopIndex < indexNeeded)) &&
      stopIndex < items.length - 1
    ) {
      stopIndex++;
      const curItem = items[stopIndex];
      this.setItemMetadata(curItem, { offset: curOffset });
      curOffset += this.getItemMetadata(curItem).height;
    }

    // overscan +1 item for a11y
    if (stopIndex < items.length - 1) {
      stopIndex++;
      const curItem = items[stopIndex];
      this.setItemMetadata(curItem, { offset: curOffset });
    }

    console.log("built offsets", {
      startIndex,
      stopIndex,
    });

    this.lastPositionedIndex = stopIndex;
  };

  onScrollThrottled = throttle((scrollTop: number) => {
    this.setState({
      offset: scrollTop,
    });
  }, 100);

  onScroll = (event: UIEvent) => {
    this.onScrollThrottled(event.currentTarget.scrollTop);
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

    this.buildOffsets(this.props, this.state);

    return this.findNearestItemBinarySearch(
      0,
      this.lastPositionedIndex,
      offset
    );
  };

  // TODO: binary search too and offsets ahead instead of simple overscan
  getStopIndex = (startIndex: number) => {
    const { items, height, overscanFactor } = this.props;
    const { offset } = this.state;

    const startItem = items[startIndex];
    const itemMetadata = this.getItemMetadata(startItem);
    const maxOffset = offset + height * overscanFactor;

    let curOffset = itemMetadata.offset + itemMetadata.height;
    let stopIndex = startIndex;

    while (stopIndex < items.length - 1 && curOffset < maxOffset) {
      stopIndex++;
      curOffset += this.getItemMetadata(items[stopIndex]).height;
    }

    return stopIndex;
  };

  getStartAndStopIndex = () => {
    const { items } = this.props;

    if (items.length === 0) {
      return [0, -1, 0, -1];
    }

    const startIndex = this.getStartIndex();
    const stopIndex = this.getStopIndex(startIndex);

    return [
      Math.max(0, startIndex - 1), // for a11y
      Math.max(0, Math.min(items.length - 1, stopIndex + 1)), // for a11y
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
        Math.max(0, getFirstIndexDiffer(items, prevItems) - 1)
      );

      this.forceUpdate();
    }
  }

  forceUpdateDebounced = debounce(() => {
    const delta = this.scrollTopDelta;
    this.scrollTopDelta = 0;

    this.forceUpdate(() => {
      if (this.outerContainerRef.current) {
        this.outerContainerRef.current.scrollTop += delta;
      }
    });
  }, 1);

  onResize = (index: number) => (contentRect: ContentRect) => {
    const { items } = this.props;
    const { offset } = this.state;

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

    if (metadata.offset < offset) {
      this.scrollTopDelta += newHeight - oldHeight;
    }

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

  forceUpdateAwait = () => new Promise((resolve) => {
    this.forceUpdate(resolve);
  });

  scrollToIndex = async (index: number, retries = 3): Promise<number> => {
    const { items, height } = this.props;

    if (this.indexToFocus !== null && this.indexToFocus !== index) {
      throw new Error(
        `Already scrolling to index: ${this.indexToFocus}, but got index: ${index}`
      );
    }

    if (!this.innerContainerRef.current || !this.outerContainerRef.current) {
      this.indexToFocus = null;
      throw new Error("Containers are not initialized yet");
    }

    this.indexToFocus = index;

    this.buildOffsets(this.props, this.state);
    const { offset } = this.getItemMetadata(items[index]);
    const newContainerHeight = this.getEstimatedTotalHeight();
    this.innerContainerRef.current.style.height = `${newContainerHeight}px`;
    const maxPossibleOffset = newContainerHeight - height;
    const newOffset = Math.min(maxPossibleOffset, offset);
    this.outerContainerRef.current.scrollTop = newOffset;

    await this.forceUpdateAwait(); // wait for new layout and getitem metadata

    const { offset: offsetAfterMeasures } = this.getItemMetadata(items[index]);

    if (offsetAfterMeasures !== newOffset && retries > 0) {
      return this.scrollToIndex(index, retries - 1);
    }

    this.indexToFocus = null;
    return this.outerContainerRef.current.scrollTop;
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
      <div
        style={{
          width,
          height,
          position: "relative",
          overflow: "auto",
          WebkitOverflowScrolling: "touch",
          willChange: "transform",
        }}
        onScroll={this.onScroll}
        ref={this.outerContainerRef}
      >
        <div
          style={{
            height: estimatedTotalHeight,
            width: "100%",
            position: "relative",
          }}
          ref={this.innerContainerRef}
        >
          {itemsToRender}
        </div>
      </div>
    );
  }
}
