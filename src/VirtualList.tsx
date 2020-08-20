import React, { UIEvent } from "react";
import ReactDOM from "react-dom";
import throttle from "lodash-es/throttle";
import debounce from "lodash-es/debounce";
import { ItemMeasure } from "./ItemMeasure";
import { getFirstIndexDiffer, wait } from "./utils";
import { trace } from "./trace";
import { OffsetCorrector } from "./OffsetCorrector";

const DEFAULT_ESTIMATED_HEIGHT = 50;
const SCROLL_THROTTLE_MS = 100;
const MEASURE_UPDATE_DEBOUNCE_MS = 50;
const SCROLL_DEBOUNCE_MS = 400 * 5;

// TODO: handle scrollTop negative
// TODO: refactor OffsetCorrector and rename
// TODO: count changing arrays
// TODO: calculate anchor index properly
// TODO: check on mobile
// TODO: tests

interface VirtualListProps<Item> {
  height: number;
  width: number;
  getItemKey: (item: Item) => string;
  estimatedItemHeight: number;
  renderRow: (renderRowProps: RenderRowProps<Item>) => React.ReactNode;
  reversed: boolean;
  items: Item[];
  selectedItem: Item;
}

interface VirtualListState<Item> {
  startIndexToRender: number;
  stopIndexToRender: number;
  items: Item[];
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

// TODO: proper type, item or index
interface ScrollToParams<Item> {
  item?: Item;
  index?: number;
  retries?: number;
}

enum ScrollingDirection {
  up,
  down,
}

export class VirtualList<Item extends Object> extends React.PureComponent<
  VirtualListProps<Item>,
  VirtualListState<Item>
> {
  static defaultProps = {
    estimatedItemHeight: DEFAULT_ESTIMATED_HEIGHT,
    reversed: false,
    selectedItem: null,
  };

  state = {
    startIndexToRender: 0, // startIndex for virtual window to render
    stopIndexToRender: -1, // stopIndex for virtual window to render
    items: [],
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

      return {
        meta,
        created: true,
      };
    }

    return {
      meta: this.itemToMetadata.get(item)!,
      created: false,
    };
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

    // in case empty list
    if (!lastPositionedItem) {
      return {
        startIndexToRender: 0,
        stopIndexToRender: -1,
        lastPositionedIndex: 0,
        anchorItem: null,
      };
    }

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
        items,
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
      items,
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
    items: Item[],
    startIndex: number,
    indexMustBeCalculated: number,
    offset: number
  ) => {
    const { height } = this.props;

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
      this.setItemMetadata(curItem, { offset: curOffset });
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
      this.setItemMetadata(curItem, { offset: curOffset });
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
    const { items, reversed, selectedItem } = this.props;

    this.forceUpdate(() => {
      if (selectedItem) {
        this.scrollTo({
          item: selectedItem,
        });
      } else if (reversed) {
        this.scrollTo({ index: items.length - 1 });
      }
    }); // for initial did update
  }

  componentDidUpdate(
    prevProps: Readonly<VirtualListProps<Item>>,
    prevState: Readonly<VirtualListState<Item>>
  ): void {
    trace(this.props, this.state, prevProps, prevState);

    const { items: newItems, height, reversed } = this.props;
    const { items: prevItems } = this.state;

    const { startIndexToRender, stopIndexToRender } = this.state;
    let correctedLastPositionedIndex = null;
    let indexMustBeCalculated =
      this.scrollingToIndex === null ? 0 : this.scrollingToIndex;

    let curItems: Item[] = prevItems;
    let scrollTopDeltaByHeightCorrection = 0;

    if (!this.isScrolling && this.offsetCorrector.isInitialized()) {
      this.lastPositionedIndex = this.offsetCorrector.getLastCorrectedIndex();
      const correctedHeightsMap = this.offsetCorrector.getHeightDeltaMap();
      correctedHeightsMap.forEach((correction, index) => {
        const { height } = this.getItemMetadata(curItems[index]);

        scrollTopDeltaByHeightCorrection += correction;

        this.setItemMetadata(curItems[index], {
          height: height + correction,
          measured: true,
        });
      });

      this.offsetCorrector.clear();
    }

    let scrollTopDeltaByAddedNew = 0;
    if (newItems !== prevItems && !this.isScrolling) {
      const differFrom = getFirstIndexDiffer(newItems, prevItems);

      if (differFrom <= this.lastPositionedIndex) {
        correctedLastPositionedIndex = Math.max(0, differFrom - 1);
      }

      indexMustBeCalculated = Math.min(
        newItems.length - 1,
        Math.max(
          stopIndexToRender + Math.max(0, newItems.length - prevItems.length), // in case huge prepend items
          indexMustBeCalculated
        )
      );

      let anchorExists = false;
      for (let i = differFrom; i < indexMustBeCalculated; i++) {
        const curItem = newItems[i];

        const { created, meta } = this.ensureItemMetadata(curItem);

        if (curItem === this.anchorItem) {
          anchorExists = true;
          break;
        }

        if (created) {
          scrollTopDeltaByAddedNew += meta.height;
        }
      }

      if (!anchorExists && !reversed) {
        scrollTopDeltaByAddedNew = 0;
      }

      curItems = newItems;
    }

    let stopIndexOffsetBefore = 0;
    if (stopIndexToRender >= 0) {
      stopIndexOffsetBefore =
        this.getItemMetadata(curItems[stopIndexToRender]).offset +
        this.offsetCorrector.getOffsetDelta(stopIndexToRender);
    }

    const {
      stopIndexToRender: newStopIndexToRender,
      startIndexToRender: newStartIndexToRender,
      lastPositionedIndex: newLastPositionedIndex,
      anchorItem: newAnchorItem,
    } = this.buildItemsMetadata({
      items: curItems,
      height,
      offset:
        this.offset +
        scrollTopDeltaByHeightCorrection +
        scrollTopDeltaByAddedNew,
      lastPositionedIndex:
        correctedLastPositionedIndex === null
          ? this.lastPositionedIndex
          : correctedLastPositionedIndex,
      indexMustBeCalculated,
    });

    this.lastPositionedIndex = newLastPositionedIndex;
    this.anchorItem = newAnchorItem;

    let stopIndexOffsetAfter = 0;
    if (stopIndexToRender >= 0) {
      stopIndexOffsetAfter =
        this.getItemMetadata(curItems[newStopIndexToRender]).offset +
        this.offsetCorrector.getOffsetDelta(newStopIndexToRender);
    }

    const scrollTopAdjustment =
      scrollTopDeltaByAddedNew + scrollTopDeltaByHeightCorrection;

    if (
      startIndexToRender !== newStartIndexToRender ||
      stopIndexToRender !== newStopIndexToRender ||
      curItems !== prevItems
    ) {
      this.setState(
        {
          startIndexToRender: newStartIndexToRender,
          stopIndexToRender: newStopIndexToRender,
          items: curItems,
        },
        () => {
          if (scrollTopAdjustment && this.containerRef.current) {
            console.log(
              "Logger: scrollTopDelta adjusting",
              scrollTopDeltaByHeightCorrection
            );
            this.containerRef.current.scrollTop +=
              scrollTopDeltaByHeightCorrection + scrollTopDeltaByAddedNew;
          }
        }
      );
    } else if (
      scrollTopAdjustment ||
      stopIndexOffsetAfter !== stopIndexOffsetBefore
    ) {
      this.forceUpdate(() => {
        if (scrollTopAdjustment && this.containerRef.current) {
          console.log(
            "Logger: scrollTopDelta adjusting",
            scrollTopDeltaByHeightCorrection
          );
          this.containerRef.current.scrollTop +=
            scrollTopDeltaByHeightCorrection + scrollTopDeltaByAddedNew;
        }
      });
    }
  }

  forceUpdateDebounced = debounce(() => {
    this.forceUpdate();
  }, MEASURE_UPDATE_DEBOUNCE_MS);

  onResize = (index: number, contentRect: DOMRectReadOnly) => {
    const { items } = this.state;

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
        this.offsetCorrector.addNewHeightDelta(
          index,
          newHeight - originalHeight
        );
      } else if (index <= this.offsetCorrector.firstCorrectedIndex) {
        this.offsetCorrector.addNewHeightDelta(
          index,
          newHeight - originalHeight
        );
      }
    } else if (this.offsetCorrector.getHeightDeltaMap().has(index)) {
      this.offsetCorrector.addNewHeightDelta(index, newHeight - originalHeight);
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

  getIndexByItem = (item: Item) => {
    return this.props.items.findIndex((i) => i === item);
  };

  scrollTo = async (params: ScrollToParams<Item>): Promise<number> => {
    console.log("running scrollTo", params);

    if (!params.item && typeof params.index !== "number") {
      this.scrollingToIndex = null;
      throw new Error("Index or item must be specified");
    }

    const { item, index = this.getIndexByItem(item!), retries = 5 } = params;

    if (this.scrollingToIndex !== null && this.scrollingToIndex !== index) {
      throw new Error(
        `Already scrolling to index: ${this.scrollingToIndex}, but got index: ${params.index}`
      );
    }

    if (!this.containerRef.current) {
      this.scrollingToIndex = null;
      throw new Error("Container is not initialized yet");
    }

    if (index >= this.props.items.length) {
      this.scrollingToIndex = null;
      throw new Error("Index is out of items array");
    }

    this.scrollingToIndex = index; // componentDU knows about it

    await this.forceUpdateAsync(); // wait for building new metadata by buildItemsMetadata

    const { items: itemsProps, height, estimatedItemHeight } = this.props;
    const { items: itemsState } = this.state;

    if (itemsProps !== itemsState) {
      throw new Error(
        "Items from props have not been applied yet because list is scrolling and is using corrected offsets"
      );
    }

    const { offset: itemOffset } = this.getItemMetadata(itemsProps[index]);
    const containerHeight = this.getEstimatedTotalHeight(
      itemsProps,
      estimatedItemHeight,
      this.lastPositionedIndex
    );
    const maxPossibleOffset = Math.max(0, containerHeight - height);
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

    return this.scrollTo({ index, item, retries: retries - 1 });
  };

  render() {
    const {
      height,
      width,
      renderRow,
      getItemKey,
      estimatedItemHeight,
      reversed,
    } = this.props;
    const { items, startIndexToRender, stopIndexToRender } = this.state;

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
            const curHeight = height + this.offsetCorrector.getHeightDelta(i);

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
        <div
          style={{
            width,
            height: curHeight,
            overflow: curOverflow,
            WebkitOverflowScrolling: "touch",
            willChange: "transform",
            position: "absolute",
            bottom: reversed ? 0 : undefined,
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
      </div>
    );
  }
}
