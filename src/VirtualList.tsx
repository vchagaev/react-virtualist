import React, { UIEvent } from "react";
import throttle from "lodash-es/throttle";
import Measure, { ContentRect } from "react-measure";
import debounce from "lodash-es/debounce";

// TODO: avoid rerenderings
// TODO: cache for styles?
// TODO: fix big batch prepend
// TODO: fix laggy resize on item boundary
// TODO: check fps and may be scrollTop as class prop

const wait = (ms: number) => new Promise((resolve) => {
  setTimeout(resolve, ms);
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

interface VirtualListState {
  offset: number;
  startIndexToRender: number;
  stopIndexToRender: number;
  lastPositionedIndex: number;
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

interface BuildOffsetsOptions<Item> {
  items: Item[];
  height: number;
  overscanFactor: number;
  offset: number;
  lastPositionedIndex: number;
  indexMustBeCalculated: number;
}

const DEFAULT_ESTIMATED_HEIGHT = 50;
const DEFAULT_OVERSCAN_FACTOR = 1;
const SCROLL_THROTTLE_MS = 100;

export class VirtualList<Item extends Object> extends React.PureComponent<
  VirtualListProps<Item>,
  VirtualListState
> {
  static defaultProps = {
    estimatedItemHeight: DEFAULT_ESTIMATED_HEIGHT,
    overscanFactor: DEFAULT_OVERSCAN_FACTOR,
  };

  state = {
    offset: 0,
    startIndexToRender: 0,
    stopIndexToRender: -1,
    lastPositionedIndex: 0,
  };

  itemToMetadata: WeakMap<Item, ItemMetadata> = new WeakMap<
    Item,
    ItemMetadata
  >();
  innerContainerRef = React.createRef<HTMLDivElement>();
  outerContainerRef = React.createRef<HTMLDivElement>();
  adjustScrollTopDeltaOnResizes: number = 0; // TODO: as an object for resizes
  lastPositionedIndexAfterResizes: number | null = null;
  scrollingToIndex: number | null = null;

  ensureItem = (
    item: Item,
    onCacheMiss?: (meta: ItemMetadata) => void,
    newMeta?: Partial<ItemMetadata>
  ) => {
    const { estimatedItemHeight } = this.props;

    if (!item) {
      debugger;
    }

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

  /**
   * Build offsets for current view or needed index
   */
  buildOffsetsForCurrentOffsetOrNeededIndex = ({
    items,
    height,
    overscanFactor,
    offset,
    lastPositionedIndex,
    indexMustBeCalculated = 0,
  }: BuildOffsetsOptions<Item>) => {
    let scrollTopDelta = 0;

    const adjustScrollTopDelta = (itemMeta: ItemMetadata) => {
      if (itemMeta.offset < offset) {
        scrollTopDelta += itemMeta.height;
      }
    };

    const lastPositionedItem = items[lastPositionedIndex];
    const lastPositionedItemMetadata = this.getItemMetadata(
      lastPositionedItem,
      adjustScrollTopDelta
    );
    const targetOffset = Math.max(0, offset - height * overscanFactor);

    if (
      lastPositionedIndex >= items.length - 1 ||
      lastPositionedItemMetadata.offset > targetOffset
    ) {
      const startIndexToRender = this.getStartIndex(
        items,
        offset,
        lastPositionedIndex
      );
      const { stopIndex, lastCalculatedIndex } = this.calculateStopIndex(
        startIndexToRender,
        indexMustBeCalculated,
        adjustScrollTopDelta
      );
      const newLastPositionedIndex = Math.max(
        lastPositionedIndex,
        lastCalculatedIndex
      );

      return {
        startIndexToRender,
        stopIndexToRender: stopIndex,
        lastPositionedIndex: newLastPositionedIndex,
        scrollTopDelta,
      };
    }

    const { stopIndex, lastCalculatedIndex } = this.calculateStopIndex(
      lastPositionedIndex,
      indexMustBeCalculated,
      adjustScrollTopDelta
    );
    const newLastPositionedIndex = Math.max(
      lastPositionedIndex,
      lastCalculatedIndex
    );
    const startIndexToRender = this.getStartIndex(
      items,
      offset,
      newLastPositionedIndex
    );

    return {
      startIndexToRender,
      stopIndexToRender: stopIndex,
      lastPositionedIndex: newLastPositionedIndex,
      scrollTopDelta,
    };
  };

  onScrollThrottled = throttle((scrollTop: number) => {
    this.setState({
      offset: scrollTop,
    });
  }, SCROLL_THROTTLE_MS);

  onScroll = (event: UIEvent) => {
    this.onScrollThrottled(event.currentTarget.scrollTop);
  };

  findNearestItemBinarySearch = (
    items: Item[],
    offset: number,
    lastPositionedIndex: number
  ) => {
    let low = 0;
    let high = lastPositionedIndex;

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

  getStartIndex = (
    items: Item[],
    offset: number,
    lastPositionedIndex: number
  ) => {
    const nearestIndex = this.findNearestItemBinarySearch(
      items,
      offset,
      lastPositionedIndex
    );

    return Math.max(0, nearestIndex - 1); // for a11y
  };

  calculateStopIndex = (
    startIndex: number,
    indexMustBeCalculated: number,
    onCacheMiss?: (itemMeta: ItemMetadata) => void
  ) => {
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
      this.setItemMetadata(curItem, { offset: curOffset }, onCacheMiss);
      curOffset += this.getItemMetadata(curItem, onCacheMiss).height;
    }

    // for a11y
    if (stopIndex < items.length - 1) {
      stopIndex++;
      const curItem = items[stopIndex];
      this.setItemMetadata(curItem, { offset: curOffset }, onCacheMiss);
      curOffset += this.getItemMetadata(curItem, onCacheMiss).height;
    }

    const stopIndexWindow = stopIndex;

    // in case we need to calculate more
    while (
      (curOffset < targetOffset || stopIndex < indexMustBeCalculated) &&
      stopIndex < items.length - 1
    ) {
      stopIndex++;
      const curItem = items[stopIndex];
      this.setItemMetadata(curItem, { offset: curOffset }, onCacheMiss);
      curOffset += this.getItemMetadata(curItem, onCacheMiss).height;
    }

    return {
      stopIndex: stopIndexWindow,
      lastCalculatedIndex: stopIndex,
    };
  };

  componentDidMount() {
    this.forceUpdate(); // for initial did update
  }

  componentDidUpdate(prevProps: Readonly<VirtualListProps<Item>>): void {
    const { items, height, overscanFactor } = this.props;
    const { items: prevItems } = prevProps;
    const {
      lastPositionedIndex,
      stopIndexToRender,
      offset,
    } = this.state;
    let correctedLastPositionedIndex = null;
    let indexMustBeCalculated =
      this.scrollingToIndex === null ? 0 : this.scrollingToIndex;
    let itemsChanged = false;

    if (items !== prevItems) {
      itemsChanged = true;
      const differFrom = getFirstIndexDiffer(items, prevItems);

      if (differFrom <= lastPositionedIndex) {
        correctedLastPositionedIndex = Math.max(0, differFrom - 1);
      }

      indexMustBeCalculated = Math.max(
        stopIndexToRender,
        indexMustBeCalculated
      ); // in case huge prepend
    }

    const {
      stopIndexToRender: newStopIndexToRender,
      startIndexToRender: newStartIndexToRender,
      lastPositionedIndex: newLastPositionedIndex,
      scrollTopDelta,
    } = this.buildOffsetsForCurrentOffsetOrNeededIndex({
      items,
      height,
      offset,
      lastPositionedIndex:
        correctedLastPositionedIndex === null
          ? lastPositionedIndex
          : correctedLastPositionedIndex,
      overscanFactor,
      indexMustBeCalculated,
    });

    this.setState(
      (prevState): VirtualListState => {
        const {
          startIndexToRender,
          stopIndexToRender,
          lastPositionedIndex,
        } = prevState;

        if (
          itemsChanged ||
          startIndexToRender !== newStartIndexToRender ||
          stopIndexToRender !== newStopIndexToRender ||
          lastPositionedIndex !== newLastPositionedIndex
        ) {
          return {
            ...prevState,
            startIndexToRender: newStartIndexToRender,
            stopIndexToRender: newStopIndexToRender,
            lastPositionedIndex: newLastPositionedIndex,
          };
        }

        return prevState;
      },
      () => {
        if (scrollTopDelta && this.outerContainerRef.current) {
          this.outerContainerRef.current.scrollTop += scrollTopDelta;
        }
      }
    );
  }

  forceUpdateDebouncedAfterResizes = debounce(() => {
    const callback = () => {
      if (
        this.adjustScrollTopDeltaOnResizes &&
        this.outerContainerRef.current
      ) {
        this.outerContainerRef.current.scrollTop += this.adjustScrollTopDeltaOnResizes;
        this.adjustScrollTopDeltaOnResizes = 0;
      }
    };

    if (this.lastPositionedIndexAfterResizes !== null) {
      this.setState(
        {
          lastPositionedIndex: this.lastPositionedIndexAfterResizes,
        },
        callback
      );
    } else {
      this.forceUpdate(callback);
    }
  }, 1);

  onResize = (index: number) => (contentRect: ContentRect) => {
    const { items } = this.props;
    const { lastPositionedIndex, offset } = this.state;

    const item = items[index];
    const metadata = this.getItemMetadata(item);
    const newHeight = contentRect.offset ? contentRect.offset.height : 0;
    const oldHeight = metadata.height;

    if (newHeight === oldHeight) {
      return;
    }

    this.setItemMetadata(item, { height: newHeight, measured: true });

    if (metadata.offset < offset) {
      this.adjustScrollTopDeltaOnResizes += newHeight - oldHeight;
    }

    const minLastPositionedIndex =
      this.lastPositionedIndexAfterResizes === null
        ? lastPositionedIndex
        : Math.min(this.lastPositionedIndexAfterResizes, lastPositionedIndex);

    this.lastPositionedIndexAfterResizes = Math.min(
      minLastPositionedIndex,
      Math.max(0, index - 1)
    );

    this.forceUpdateDebouncedAfterResizes();
  };

  getEstimatedTotalHeight = (
    items: Item[],
    estimatedItemHeight: number,
    lastPositionedIndex: number
  ) => {
    if (items.length === 0) {
      return 0;
    }

    const lastPositionedItemMetadata = this.getItemMetadata(
      items[lastPositionedIndex]
    );

    return (
      lastPositionedItemMetadata.offset +
      lastPositionedItemMetadata.height +
      (items.length - 1 - lastPositionedIndex) * estimatedItemHeight
    );
  };

  forceUpdateAsync = () =>
    new Promise((resolve) => {
      this.forceUpdate(resolve);
    });

  scrollToIndex = async (index: number, retries = 3): Promise<number> => {
    if (this.scrollingToIndex !== null && this.scrollingToIndex !== index) {
      throw new Error(
        `Already scrolling to index: ${this.scrollingToIndex}, but got index: ${index}`
      );
    }

    if (!this.innerContainerRef.current || !this.outerContainerRef.current) {
      this.scrollingToIndex = null;
      throw new Error("Containers are not initialized yet");
    }

    if (index >= this.props.items.length) {
      this.scrollingToIndex = null;
      throw new Error("Index is out of items array");
    }

    this.scrollingToIndex = index;

    await this.forceUpdateAsync(); // wait for new state which takes into account scrollingToIndex

    const { items, height, estimatedItemHeight } = this.props;
    const {offset, lastPositionedIndex} = this.state;

    const { offset: itemOffset } = this.getItemMetadata(items[index]);
    const containerHeight = this.getEstimatedTotalHeight(
      items,
      estimatedItemHeight,
      lastPositionedIndex
    );
    const maxPossibleOffset = containerHeight - height;
    const newOffset = Math.min(maxPossibleOffset, itemOffset);

    if (offset === newOffset) {
      this.scrollingToIndex = null;
      return offset;
    } else if (retries <= 0) {
      this.scrollingToIndex = null;
      throw new Error(`Could not scroll to index ${index}. No retries left`);
    }

    this.outerContainerRef.current.scrollTop = newOffset;

    await wait(SCROLL_THROTTLE_MS * 2);

    return this.scrollToIndex(index, retries - 1);
  };

  render() {
    const {
      items,
      height,
      width,
      renderRow,
      getItemKey,
      estimatedItemHeight,
    } = this.props;
    const {
      startIndexToRender,
      stopIndexToRender,
      lastPositionedIndex,
    } = this.state;

    const estimatedTotalHeight = this.getEstimatedTotalHeight(
      items,
      estimatedItemHeight,
      lastPositionedIndex
    );

    console.log({
      startIndexToRender,
      stopIndexToRender,
    });

    const itemsToRender: React.ReactNode[] = [];
    for (let i = startIndexToRender; i <= stopIndexToRender; i++) {
      const item = items[i];
      const { offset, height, measured } = this.getItemMetadata(item);

      itemsToRender.push(
        <Measure key={getItemKey(item)} offset onResize={this.onResize(i)}>
          {({ measureRef }) => (
            <div
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
