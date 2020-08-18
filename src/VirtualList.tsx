import React, { UIEvent } from "react";
import throttle from "lodash-es/throttle";
import debounce from "lodash-es/debounce";
import { ItemMeasure } from "./ItemMeasure";
import { getFirstIndexDiffer, wait } from "./utils";
import { trace } from "./trace";

// TODO: check on mobile
// TODO: tests

interface VirtualListProps<Item> {
  items: Item[];
  height: number;
  width: number;
  getItemKey: (item: Item) => string;
  estimatedItemHeight: number;
  renderRow: (renderRowProps: RenderRowProps<Item>) => React.ReactNode;
}

interface VirtualListState<Item> {
  offset: number;
  startIndexToRender: number;
  stopIndexToRender: number;
  lastPositionedIndex: number;
  anchorItem: Item | null;
}

interface RenderRowProps<Item> {
  item: Item;
  ref: React.Ref<HTMLDivElement>; // TODO: any dom node
  offset: number;
}

type ItemMetadata = {
  height: number;
  offset: number;
  measured: boolean;
};

interface BuildOffsetsOptions<Item> {
  items: Item[];
  height: number;
  offset: number;
  lastPositionedIndex: number;
  indexMustBeCalculated: number;
  anchorItem: Item | null;
}

const DEFAULT_ESTIMATED_HEIGHT = 50;
const SCROLL_THROTTLE_MS = 100;
const MEASURE_UPDATE_DEBOUNCE_MS = 10;

export class VirtualList<Item extends Object> extends React.PureComponent<
  VirtualListProps<Item>,
  VirtualListState<Item>
> {
  static defaultProps = {
    estimatedItemHeight: DEFAULT_ESTIMATED_HEIGHT,
  };

  state = {
    offset: 0, // scrollTop container
    startIndexToRender: 0, // startIndex for virtual window to render
    stopIndexToRender: -1, // stopIndex for virtual window to render
    lastPositionedIndex: 0, // index until all offsets are calculated
    anchorItem: null,
  };

  itemToMetadata: WeakMap<Item, ItemMetadata> = new WeakMap<
    Item,
    ItemMetadata
  >();
  containerRef = React.createRef<HTMLDivElement>();
  lastPositionedIndexAfterResizes: number | null = null; // for debounce
  scrollingToIndex: number | null = null;

  ensureItemMetadata = (item: Item) => {
    const { estimatedItemHeight } = this.props;

    if (!this.itemToMetadata.has(item)) {
      const meta = {
        height: estimatedItemHeight,
        offset: 0,
        measured: false,
      };

      this.itemToMetadata.set(item, meta);
    }
  };

  setItemMetadata = (item: Item, newMeta: Partial<ItemMetadata>) => {
    this.ensureItemMetadata(item);

    const meta = this.itemToMetadata.get(item)!;

    this.itemToMetadata.set(item, { ...meta, ...newMeta });
  };

  getItemMetadata = (item: Item) => {
    this.ensureItemMetadata(item);

    return this.itemToMetadata.get(item)!;
  };

  /**
   * Build offsets for current view or needed index
   */
  buildItemsMetadata = ({
    items,
    offset,
    lastPositionedIndex,
    indexMustBeCalculated = 0,
    anchorItem,
  }: BuildOffsetsOptions<Item>) => {
    const lastPositionedItem = items[lastPositionedIndex];
    const lastPositionedItemMetadata = this.getItemMetadata(lastPositionedItem);

    let anchorItemOffsetBefore = 0;
    if (anchorItem) {
      anchorItemOffsetBefore = this.getItemMetadata(anchorItem).offset;
    }

    if (
      lastPositionedIndex >= items.length - 1 ||
      lastPositionedItemMetadata.offset > offset
    ) {
      // get start and calculate end
      const {
        startIndexToRender,
        anchorItem: newAnchorItem,
      } = this.getStartIndex(items, offset, lastPositionedIndex);

      const {
        stopIndexToRender,
        lastCalculatedIndex,
      } = this.calculateStopIndex(startIndexToRender, indexMustBeCalculated);
      const newLastPositionedIndex = Math.max(
        lastPositionedIndex,
        lastCalculatedIndex
      );

      return {
        startIndexToRender,
        stopIndexToRender,
        lastPositionedIndex: newLastPositionedIndex,
        anchorItem: newAnchorItem,
        scrollTopDelta: 0, // all items are well positioned already
      };
    }

    // get calculate start and end since lastPositionedIndex
    const { stopIndexToRender, lastCalculatedIndex } = this.calculateStopIndex(
      lastPositionedIndex,
      indexMustBeCalculated
    );
    const newLastPositionedIndex = Math.max(
      lastPositionedIndex,
      lastCalculatedIndex
    );

    let offsetFirstItemAfter = 0;
    if (anchorItem) {
      offsetFirstItemAfter = this.getItemMetadata(anchorItem).offset;
    }
    const scrollTopDelta = offsetFirstItemAfter - anchorItemOffsetBefore;

    const {
      startIndexToRender,
      anchorItem: newAnchorItem,
    } = this.getStartIndex(
      items,
      Math.max(0, offset + scrollTopDelta), // count future move of scrollTop
      newLastPositionedIndex
    );

    return {
      startIndexToRender,
      stopIndexToRender,
      lastPositionedIndex: newLastPositionedIndex,
      scrollTopDelta,
      anchorItem: newAnchorItem,
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

    return {
      anchorItem: items[nearestIndex],
      startIndexToRender: Math.max(0, nearestIndex - 1),
    }; // for a11y +1 item upper}
  };

  calculateStopIndex = (startIndex: number, indexMustBeCalculated: number) => {
    const { items, height } = this.props;
    const { offset } = this.state;

    const startItem = items[startIndex];
    const itemMetadata = this.getItemMetadata(startItem);
    const targetOffset = offset + height;

    let curOffset = itemMetadata.offset + itemMetadata.height;
    let stopIndex = startIndex;

    while (curOffset < targetOffset && stopIndex < items.length - 1) {
      stopIndex++;
      const curItem = items[stopIndex];
      this.setItemMetadata(curItem, { offset: curOffset });
      curOffset += this.getItemMetadata(curItem).height;
    }

    // for a11y +1 item
    if (stopIndex < items.length - 1) {
      stopIndex++;
      const curItem = items[stopIndex];
      this.setItemMetadata(curItem, { offset: curOffset });
      curOffset += this.getItemMetadata(curItem).height;
    }

    const stopIndexToRender = stopIndex;

    // if we need to calculate more, e.g. for go to index
    while (
      (curOffset < targetOffset || stopIndex < indexMustBeCalculated) &&
      stopIndex < items.length - 1
    ) {
      stopIndex++;
      const curItem = items[stopIndex];
      this.setItemMetadata(curItem, { offset: curOffset });
      curOffset += this.getItemMetadata(curItem).height;
    }

    return {
      stopIndexToRender,
      lastCalculatedIndex: stopIndex,
    };
  };

  componentDidMount() {
    this.forceUpdate(); // for initial did update
  }

  componentDidUpdate(
    prevProps: Readonly<VirtualListProps<Item>>,
    prevState: Readonly<VirtualListState<Item>>
  ): void {
    trace(this.props, this.state, prevProps, prevState);

    const { items, height } = this.props;
    const { items: prevItems } = prevProps;
    const {
      lastPositionedIndex,
      stopIndexToRender,
      offset,
      anchorItem,
    } = this.state;
    let correctedLastPositionedIndex = null;
    let indexMustBeCalculated =
      this.scrollingToIndex === null ? 0 : this.scrollingToIndex;

    if (items !== prevItems) {
      const differFrom = getFirstIndexDiffer(items, prevItems);

      if (differFrom <= lastPositionedIndex) {
        correctedLastPositionedIndex = Math.max(0, differFrom - 1);
      }

      // TODO: item must be calculaed?
      indexMustBeCalculated = Math.max(
        stopIndexToRender + Math.max(0, items.length - prevItems.length), // in case huge prepend items
        indexMustBeCalculated
      );
    }

    const {
      stopIndexToRender: newStopIndexToRender,
      startIndexToRender: newStartIndexToRender,
      lastPositionedIndex: newLastPositionedIndex,
      scrollTopDelta,
      anchorItem: newAnchorItem,
    } = this.buildItemsMetadata({
      items,
      height,
      offset,
      lastPositionedIndex:
        correctedLastPositionedIndex === null
          ? lastPositionedIndex
          : correctedLastPositionedIndex,
      indexMustBeCalculated,
      anchorItem,
    });

    console.log("Applying new state after build", {
      startIndexToRender: newStartIndexToRender,
      stopIndexToRender: newStopIndexToRender,
      lastPositionedIndex: newLastPositionedIndex,
      anchorItem: newAnchorItem,
    });

    this.setState(
      {
        startIndexToRender: newStartIndexToRender,
        stopIndexToRender: newStopIndexToRender,
        lastPositionedIndex: newLastPositionedIndex,
        anchorItem: newAnchorItem,
      },
      () => {
        if (scrollTopDelta && this.containerRef.current) {
          this.containerRef.current.scrollTop += scrollTopDelta;
        }
      }
    );
  }

  forceUpdateDebouncedAfterResizes = debounce(() => {
    if (this.lastPositionedIndexAfterResizes !== null) {
      this.setState({
        lastPositionedIndex: this.lastPositionedIndexAfterResizes,
      });
    } else {
      this.forceUpdate();
    }

    this.lastPositionedIndexAfterResizes = null;
  }, MEASURE_UPDATE_DEBOUNCE_MS);

  onResize = (index: number, contentRect: DOMRectReadOnly) => {
    const { items } = this.props;
    const { lastPositionedIndex } = this.state;

    const item = items[index];
    const metadata = this.getItemMetadata(item);
    const newHeight = Math.round(contentRect.height);
    const oldHeight = metadata.height;

    if (newHeight === oldHeight) {
      return;
    }

    console.log("onResize", {
      index,
      newHeight,
      oldHeight,
      delta: newHeight - oldHeight,
    });

    this.setItemMetadata(item, { height: newHeight, measured: true });

    // to rebuild offsets
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

    if (!this.containerRef.current) {
      this.scrollingToIndex = null;
      throw new Error("Containers are not initialized yet");
    }

    if (index >= this.props.items.length) {
      this.scrollingToIndex = null;
      throw new Error("Index is out of items array");
    }

    this.scrollingToIndex = index; // componentDidUpdate knows about it

    await this.forceUpdateAsync(); // wait for building new metadata by buildItemsMetadata

    const { items, height, estimatedItemHeight } = this.props;
    const { offset, lastPositionedIndex } = this.state;

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

    this.containerRef.current.scrollTop = newOffset;

    await wait(SCROLL_THROTTLE_MS * 2); // wait for state.offset to be changed by scroll

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
      anchorItem,
    } = this.state;

    const estimatedTotalHeight = this.getEstimatedTotalHeight(
      items,
      estimatedItemHeight,
      lastPositionedIndex
    );

    console.log("render", {
      startIndexToRender,
      stopIndexToRender,
      lastPositionedIndex,
    });

    const itemsToRender = [];
    for (let i = startIndexToRender; i <= stopIndexToRender; i++) {
      const item = items[i];
      const { offset, height, measured } = this.getItemMetadata(item);

      itemsToRender.push(
        <ItemMeasure key={getItemKey(item)} onResize={this.onResize} index={i}>
          {({ measureRef }) => (
            <div
              style={{
                position: "absolute",
                top: offset,
                height,
                opacity: measured ? 1 : 0,
                width: "100%",
                outline: item === anchorItem ? "1px solid red" : undefined,
              }}
            >
              {renderRow({
                ref: measureRef,
                item,
                offset,
              })}
            </div>
          )}
        </ItemMeasure>
      );
    }

    return (
      <div
        style={{
          width,
          height,
          overflow: "auto",
          WebkitOverflowScrolling: "touch",
          willChange: "transform",
          border: "1px solid grey",
        }}
        onScroll={this.onScroll}
        ref={this.containerRef}
      >
        <div
          style={{
            height: estimatedTotalHeight,
            width: "100%",
            position: "relative",
          }}
        >
          {itemsToRender}
        </div>
      </div>
    );
  }
}
