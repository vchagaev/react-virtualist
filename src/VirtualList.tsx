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
const DEFAULT_OVERSCAN_FACTOR = 1;

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
  indexMustBeCalculated: number = 0;
  scrollTopDelta: number = 0;
  startIndexToRender: number = 0;
  stopIndexToRender: number = 0;
  scrollingToIndex: number | null = null;

  ensureItem = (
    item: Item,
    onCacheMiss?: (meta: ItemMetadata) => void,
    newMeta?: Partial<ItemMetadata>
  ) => {
    const { estimatedItemHeight } = this.props;

    if (!this.itemToMetadata.has(item)) {
      const meta = {
        height: estimatedItemHeight,
        offset: 0,
        measured: false,
        ...newMeta,
      };

      this.itemToMetadata.set(item, meta);

      if (onCacheMiss) {
        onCacheMiss(meta);
      }
    }
  };

  setItemMetadata = (
    item: Item,
    newMeta: Partial<ItemMetadata>,
    onCacheMiss?: (meta: ItemMetadata) => void
  ) => {
    this.ensureItem(item, onCacheMiss, newMeta);

    const meta = this.itemToMetadata.get(item)!;

    this.itemToMetadata.set(item, { ...meta, ...newMeta });
  };

  getItemMetadata = (
    item: Item,
    onCacheMiss?: (meta: ItemMetadata) => void
  ) => {
    this.ensureItem(item, onCacheMiss);

    return this.itemToMetadata.get(item)!;
  };

  adjustScrollTop = (item: ItemMetadata, delta?: number) => {
    const { offset } = this.state;

    if (item.offset < offset) {
      this.scrollTopDelta += typeof delta === "number" ? delta : item.height;
    }
  };

  /**
   * Build offsets for current view or needed index
   */
  buildOffsetsForCurrentOffsetOrNeededIndex = (
    props: VirtualListProps<Item>,
    state: VirtualListState<Item>
  ) => {
    const { items, height, overscanFactor } = props;
    const { offset } = state;

    const lastPositionedItem = items[this.lastPositionedIndex];
    const lastPositionedItemMetadata = this.getItemMetadata(
      lastPositionedItem,
      this.adjustScrollTop
    );
    const targetOffset = Math.max(0, offset - height * overscanFactor);

    if (
      this.lastPositionedIndex >= items.length - 1 ||
      lastPositionedItemMetadata.offset > targetOffset
    ) {
      // already calculated startIndex
      this.startIndexToRender = this.getStartIndex();
      this.stopIndexToRender = this.calculateStopIndex(this.startIndexToRender);
      return;
    }

    // have to calculate startIndex
    this.stopIndexToRender = this.calculateStopIndex(
      this.lastPositionedIndex
    );
    this.startIndexToRender = this.getStartIndex();
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
  findNearestItemBinarySearch = () => {
    const { items } = this.props;
    const { offset } = this.state;
    let low = 0;
    let high = this.lastPositionedIndex;

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
    const nearestIndex = this.findNearestItemBinarySearch();

    return Math.max(0, nearestIndex - 1); // for a11y
  };

  calculateStopIndex = (startIndex: number) => {
    const { items, height, overscanFactor } = this.props;
    const { offset } = this.state;

    const startItem = items[startIndex];
    const itemMetadata = this.getItemMetadata(startItem);
    const targetOffset = offset + height * overscanFactor;

    let curOffset = itemMetadata.offset + itemMetadata.height;
    let stopIndex = startIndex;

    while (curOffset < targetOffset && stopIndex < items.length - 1) {
      stopIndex++;
      const curItem = items[stopIndex];
      this.setItemMetadata(
        curItem,
        { offset: curOffset },
        this.adjustScrollTop
      );
      curOffset += this.getItemMetadata(curItem, this.adjustScrollTop).height;
    }

    // for a11y
    if (stopIndex < items.length - 1) {
      stopIndex++;
      const curItem = items[stopIndex];
      this.setItemMetadata(
        curItem,
        { offset: curOffset },
        this.adjustScrollTop
      );
      curOffset += this.getItemMetadata(curItem, this.adjustScrollTop).height;
    }

    const stopIndexWindow = stopIndex;

    // in case we need to calculate more
    while (
      (curOffset < targetOffset || stopIndex < this.indexMustBeCalculated) &&
      stopIndex < items.length - 1
    ) {
      stopIndex++;
      const curItem = items[stopIndex];
      this.setItemMetadata(
        curItem,
        { offset: curOffset },
        this.adjustScrollTop
      );
      curOffset += this.getItemMetadata(curItem, this.adjustScrollTop).height;
    }
    this.indexMustBeCalculated = 0;

    this.lastPositionedIndex = Math.max(this.lastPositionedIndex, stopIndex);

    return stopIndexWindow;
  };

  componentDidUpdate(
    prevProps: Readonly<VirtualListProps<Item>>,
    prevState: Readonly<VirtualListState<Item>>,
    scrollTopDelta?: number
  ): void {
    const { items } = this.props;
    const { items: prevItems } = prevProps;

    if (scrollTopDelta && this.outerContainerRef.current) {
      this.outerContainerRef.current.scrollTop += scrollTopDelta;
    }

    if (items !== prevItems) {
      this.lastPositionedIndex = Math.min(
        this.lastPositionedIndex,
        Math.max(0, getFirstIndexDiffer(items, prevItems) - 1)
      );
      this.indexMustBeCalculated = this.stopIndexToRender; // in case huge prepend

      this.forceUpdate();
    }
  }

  // TODO: do I need it?
  getSnapshotBeforeUpdate() {
    if (this.scrollTopDelta && this.outerContainerRef.current) {
      const delta = this.scrollTopDelta;
      this.scrollTopDelta = 0;
      return delta;
    }

    return null;
  }

  forceUpdateDebounced = debounce(() => {
    this.forceUpdate();
  }, 1);

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

    this.adjustScrollTop(metadata, newHeight - oldHeight);

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

  forceUpdateAwait = () =>
    new Promise((resolve) => {
      this.forceUpdate(resolve);
    });

  scrollToIndex = async (index: number, retries = 3): Promise<number> => {
    const { items, height } = this.props;

    if (this.scrollingToIndex !== null && this.scrollingToIndex !== index) {
      throw new Error(
        `Already scrolling to index: ${this.scrollingToIndex}, but got index: ${index}`
      );
    }

    if (!this.innerContainerRef.current || !this.outerContainerRef.current) {
      this.scrollingToIndex = 0;
      throw new Error("Containers are not initialized yet");
    }

    if (index >= items.length) {
      this.scrollingToIndex = 0;
      throw new Error("Index is out of items array");
    }

    this.indexMustBeCalculated = index;
    this.scrollingToIndex = index;

    this.buildOffsetsForCurrentOffsetOrNeededIndex(this.props, this.state);
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

    this.scrollingToIndex = null;
    return this.outerContainerRef.current.scrollTop;
  };

  render() {
    const { items, height, width, renderRow, getItemKey } = this.props;

    this.buildOffsetsForCurrentOffsetOrNeededIndex(this.props, this.state);
    const estimatedTotalHeight = this.getEstimatedTotalHeight();

    console.log({
      startIndex: this.startIndexToRender,
      stopIndex: this.stopIndexToRender,
    });

    const itemsToRender: React.ReactNode[] = [];
    for (let i = this.startIndexToRender; i <= this.stopIndexToRender; i++) {
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
