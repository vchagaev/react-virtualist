import React, { UIEvent } from "react";
import ReactDOM from "react-dom";
import throttle from "lodash-es/throttle";
import debounce from "lodash-es/debounce";
import { ItemMeasure } from "./ItemMeasure";
import { getFirstIndexDiffer, wait } from "./utils";
import { trace } from "./trace";
import { OffsetCorrector } from "./OffsetCorrector";

// TODO: handle scrollTop negative
// TODO: refactor OffsetCorrector and rename
// TODO: count changing arrays
// TODO: calculate anchor index properly
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

interface VirtualListState {
  startIndexToRender: number;
  stopIndexToRender: number;
}

interface RenderRowProps<Item> {
  item: Item;
  ref: React.Ref<HTMLDivElement>; // TODO: any dom node
  offset: string;
  height: string;
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
}

const DEFAULT_ESTIMATED_HEIGHT = 50;
const SCROLL_THROTTLE_MS = 100;
const MEASURE_UPDATE_DEBOUNCE_MS = 50;
const SCROLL_DEBOUNCE_MS = 60 * 1000;

enum ScrollingDirection {
  up,
  down,
}

export class VirtualList<Item extends Object> extends React.PureComponent<
  VirtualListProps<Item>,
  VirtualListState
> {
  static defaultProps = {
    estimatedItemHeight: DEFAULT_ESTIMATED_HEIGHT,
  };

  state = {
    startIndexToRender: 0, // startIndex for virtual window to render
    stopIndexToRender: -1, // stopIndex for virtual window to render
  };

  itemToMetadata: WeakMap<Item, ItemMetadata> = new WeakMap<
    Item,
    ItemMetadata
  >();
  offset: number = 0;
  anchorItem: Item | null = null;
  containerRef = React.createRef<HTMLDivElement>();
  lastPositionedIndex: number = 0; // for debounce
  scrollingToIndex: number | null = null;
  isScrolling: boolean = false;
  offsetCorrector: OffsetCorrector = new OffsetCorrector();
  scrollingDirection: ScrollingDirection = ScrollingDirection.down;

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
  }: BuildOffsetsOptions<Item>) => {
    const lastPositionedItem = items[lastPositionedIndex];
    const lastPositionedItemMetadata = this.getItemMetadata(lastPositionedItem);

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
      } = this.calculateStopIndex(
        startIndexToRender,
        indexMustBeCalculated,
        offset
      );
      const newLastPositionedIndex = Math.max(
        lastPositionedIndex,
        lastCalculatedIndex
      );

      return {
        startIndexToRender,
        stopIndexToRender,
        lastPositionedIndex: newLastPositionedIndex,
        anchorItem: newAnchorItem,
      };
    }

    // get calculate start and end since lastPositionedIndex
    const { stopIndexToRender, lastCalculatedIndex } = this.calculateStopIndex(
      lastPositionedIndex,
      indexMustBeCalculated,
      offset
    );
    const newLastPositionedIndex = Math.max(
      lastPositionedIndex,
      lastCalculatedIndex
    );

    const {
      startIndexToRender,
      anchorItem: newAnchorItem,
    } = this.getStartIndex(items, offset, newLastPositionedIndex);

    return {
      startIndexToRender,
      stopIndexToRender,
      lastPositionedIndex: newLastPositionedIndex,
      anchorItem: newAnchorItem,
    };
  };

  onScrollDebounced = debounce(() => {
    this.isScrolling = false;

    console.log("Logger: rerender because isScrolling false");

    this.forceUpdate();
  }, SCROLL_DEBOUNCE_MS);

  onScrollThrottled = throttle((scrollTop: number) => {
    this.scrollingDirection =
      scrollTop <= this.offset
        ? ScrollingDirection.up
        : ScrollingDirection.down;
    this.offset = Math.round(scrollTop);
    this.isScrolling = true;

    this.onScrollDebounced();

    console.log("Logger: rerender because offset:", this.offset);

    this.forceUpdate();
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
      const currentOffset =
        this.getItemMetadata(items[middle]).offset +
        this.offsetCorrector.getOffsetDelta(middle);

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

  calculateStopIndex = (
    startIndex: number,
    indexMustBeCalculated: number,
    offset: number
  ) => {
    const { items, height } = this.props;

    const startItem = items[startIndex];
    const itemMetadata = this.getItemMetadata(startItem);
    const targetOffset = offset + height;

    let curOffsetCorrected =
      itemMetadata.offset +
      itemMetadata.height +
      this.offsetCorrector.getOffsetDelta(startIndex) +
      this.offsetCorrector.getHeightDelta(startIndex);
    let curOffset = itemMetadata.offset + itemMetadata.height;
    let stopIndex = startIndex;

    while (curOffsetCorrected < targetOffset && stopIndex < items.length - 1) {
      stopIndex++;
      const curItem = items[stopIndex];
      this.setItemMetadata(curItem, { offset: curOffset });
      curOffset += this.getItemMetadata(curItem).height; // измененный height
      curOffsetCorrected +=
        this.getItemMetadata(curItem).height +
        this.offsetCorrector.getHeightDelta(stopIndex);
    }

    // for a11y +1 item
    if (stopIndex < items.length - 1) {
      stopIndex++;
      const curItem = items[stopIndex];
      this.setItemMetadata(curItem, { offset: curOffsetCorrected });
      curOffset += this.getItemMetadata(curItem).height;
      curOffsetCorrected +=
        this.getItemMetadata(curItem).height +
        this.offsetCorrector.getHeightDelta(stopIndex);
    }

    const stopIndexToRender = stopIndex;

    // if we need to calculate more, e.g. for go to index
    // TODO: delete curCorrected < targetOffset it is always true
    while (
      (curOffsetCorrected < targetOffset ||
        stopIndex < indexMustBeCalculated) &&
      stopIndex < items.length - 1
    ) {
      stopIndex++;
      const curItem = items[stopIndex];
      this.setItemMetadata(curItem, { offset: curOffsetCorrected });
      curOffset += this.getItemMetadata(curItem).height;
      curOffsetCorrected +=
        this.getItemMetadata(curItem).height +
        this.offsetCorrector.getHeightDelta(stopIndex);
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
    prevState: Readonly<VirtualListState>
  ): void {
    trace(this.props, this.state, prevProps, prevState);

    const { items, height } = this.props;
    const { items: prevItems } = prevProps;
    const { startIndexToRender, stopIndexToRender } = this.state;
    let correctedLastPositionedIndex = null;
    let indexMustBeCalculated =
      this.scrollingToIndex === null ? 0 : this.scrollingToIndex;

    // TODO: items to state
    // TODO: derived items to state if no scroll or around start
    if (items !== prevItems) {
      // what if modification during scroll?
      const differFrom = getFirstIndexDiffer(items, prevItems);

      if (differFrom <= this.lastPositionedIndex) {
        correctedLastPositionedIndex = Math.max(0, differFrom - 1);
      }

      // TODO: item must be calculaed? anchor and scrollToItem
      indexMustBeCalculated = Math.max(
        stopIndexToRender + Math.max(0, items.length - prevItems.length), // in case huge prepend items
        indexMustBeCalculated
      );
    }

    let stopIndexOffsetBefore = 0;
    if (stopIndexToRender >= 0) {
      stopIndexOffsetBefore =
        this.getItemMetadata(items[stopIndexToRender]).offset +
        this.offsetCorrector.getOffsetDelta(stopIndexToRender);
    }

    let scrollTopDelta = 0;

    if (!this.isScrolling && this.offsetCorrector.isInitialized()) {
      this.lastPositionedIndex = this.offsetCorrector.getLastCorrectedIndex();
      const correctedHeightsMap = this.offsetCorrector.getHeightDeltaMap();

      correctedHeightsMap.forEach((correction, index) => {
        const { height } = this.getItemMetadata(items[index]);

        scrollTopDelta += correction;

        this.setItemMetadata(items[index], {
          height: height + correction,
          measured: true,
        });
      });

      this.offsetCorrector.clear();
    }

    const {
      stopIndexToRender: newStopIndexToRender,
      startIndexToRender: newStartIndexToRender,
      lastPositionedIndex: newLastPositionedIndex,
      anchorItem: newAnchorItem,
    } = this.buildItemsMetadata({
      items,
      height,
      offset: this.offset + scrollTopDelta,
      lastPositionedIndex:
        correctedLastPositionedIndex === null
          ? this.lastPositionedIndex
          : correctedLastPositionedIndex,
      indexMustBeCalculated,
    });

    this.lastPositionedIndex = newLastPositionedIndex;
    this.anchorItem = newAnchorItem;

    const stopIndexOffsetAfter =
      this.getItemMetadata(items[newStopIndexToRender]).offset +
      this.offsetCorrector.getOffsetDelta(newStopIndexToRender);

    if (scrollTopDelta) {
      console.log("Logger: rerender because scrollTopDelta", scrollTopDelta);
    }
    if (stopIndexToRender !== newStopIndexToRender) {
      console.log(
        "Logger: rerender because stopIndexOffsetAfter !== stopIndexOffsetBefore",
        stopIndexOffsetBefore,
        stopIndexOffsetAfter
      );
    }

    if (
      startIndexToRender !== newStartIndexToRender ||
      stopIndexToRender !== newStopIndexToRender
    ) {
      this.setState(
        {
          startIndexToRender: newStartIndexToRender,
          stopIndexToRender: newStopIndexToRender,
        },
        () => {
          if (scrollTopDelta && this.containerRef.current) {
            console.log("Logger: scrollTopDelta adjusting", scrollTopDelta);
            this.containerRef.current.scrollTop += scrollTopDelta;
          }
        }
      );
    } else if (
      scrollTopDelta ||
      stopIndexOffsetAfter !== stopIndexOffsetBefore
    ) {
      this.forceUpdate(() => {
        if (scrollTopDelta && this.containerRef.current) {
          console.log("Logger: scrollTopDelta adjusting", scrollTopDelta);
          this.containerRef.current.scrollTop += scrollTopDelta;
        }
      });
    }
  }

  forceUpdateDebounced = debounce(() => {
    this.forceUpdate();
  }, MEASURE_UPDATE_DEBOUNCE_MS);

  onResize = (index: number, contentRect: DOMRectReadOnly) => {
    const { items } = this.props;

    const item = items[index];
    const metadata = this.getItemMetadata(item);
    const newHeight = Math.round(contentRect.height);
    const originalHeight = metadata.height;

    if (newHeight === originalHeight) {
      return;
    }

    console.log("Logger: onResize", {
      index,
      newHeight,
      oldHeight: originalHeight,
      delta: newHeight - originalHeight,
    });

    let anchorItemIndex = this.anchorItem && (this.anchorItem as any).index; // TODO: properly

    if (anchorItemIndex === null) {
      anchorItemIndex = this.lastPositionedIndex;
    }

    if (index < anchorItemIndex && this.isScrolling) {
      if (!this.offsetCorrector.isInitialized()) {
        this.offsetCorrector.init(this.lastPositionedIndex, 0);
        this.offsetCorrector.addNewHeightDelta(index, newHeight - originalHeight);
      } else if (index <= this.offsetCorrector.firstCorrectedIndex) {
        this.offsetCorrector.addNewHeightDelta(index, newHeight - originalHeight);
      }
    } else {
      this.setItemMetadata(item, { height: newHeight, measured: true });
      this.lastPositionedIndex = Math.min(
        this.lastPositionedIndex,
        Math.max(index - 1, 0)
      );
    }

    this.forceUpdateDebounced();
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

  // TODO: without async
  scrollToIndex = async (index: number, retries = 2): Promise<number> => {
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

    const { offset: itemOffset } = this.getItemMetadata(items[index]);
    const containerHeight = this.getEstimatedTotalHeight(
      items,
      estimatedItemHeight,
      this.lastPositionedIndex
    );
    const maxPossibleOffset = containerHeight - height;
    const newOffset = Math.min(
      maxPossibleOffset,
      itemOffset + this.offsetCorrector.getOffsetDelta(index)
    );

    if (this.offset === newOffset) {
      this.scrollingToIndex = null;
      return this.offset;
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
    const { startIndexToRender, stopIndexToRender } = this.state;

    const estimatedTotalHeight = this.getEstimatedTotalHeight(
      items,
      estimatedItemHeight,
      this.lastPositionedIndex
    );

    console.log("render", {
      startIndexToRender,
      stopIndexToRender,
    });

    const itemsToRender = [];
    for (let i = startIndexToRender; i <= stopIndexToRender; i++) {
      const item = items[i];
      const { offset, height, measured } = this.getItemMetadata(item);

      itemsToRender.push(
        <ItemMeasure key={getItemKey(item)} onResize={this.onResize} index={i}>
          {({ measureRef }) => {
            const top = offset + this.offsetCorrector.getOffsetDelta(i);
            const curHeight =
              height + this.offsetCorrector.getHeightDelta(i);

            return (
              <div
                style={{
                  position: "absolute",
                  top,
                  height: curHeight,
                  opacity:
                    measured || this.offsetCorrector.getHeightDelta(i)
                      ? 1
                      : 0.1,
                  width: "100%",
                  backgroundColor:
                    this.anchorItem === item
                      ? "pink"
                      : this.offsetCorrector.getOffsetDelta(i)
                      ? "yellow"
                      : "transparent",
                  outline:
                    item === this.anchorItem ? "4px solid red" : undefined,
                }}
              >
                {renderRow({
                  ref: measureRef,
                  item,
                  offset: `${offset} + ${this.offsetCorrector.getOffsetDelta(
                    i
                  )} = ${top}`,
                  height: `${height} + ${this.offsetCorrector.getHeightDelta(
                    i
                  )} = ${curHeight}`,
                })}
              </div>
            );
          }}
        </ItemMeasure>
      );
    }

    this.offsetCorrector.log();

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
        {ReactDOM.createPortal(
          <div className="debug-info">
            <span>startIndexToRender: {startIndexToRender}</span>
            <span>stopIndexToRender: {stopIndexToRender}</span>
            <span>offset: {this.offset}</span>
            <span>
              anchorItemIndex:{" "}
              {this.anchorItem && (this.anchorItem as any).index}
            </span>
            <span>lastPositionedIndex: {this.lastPositionedIndex}</span>
            <span>scrollingToIndex: {this.scrollingToIndex}</span>
            <span>isScrolling: {this.isScrolling ? "true" : "false"}</span>
            <span>
              scrollingDirection: {this.scrollingDirection ? "down" : "up"}
            </span>
          </div>,
          document.getElementById("debug-container")!
        )}
      </div>
    );
  }
}
