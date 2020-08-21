import React, { CSSProperties, UIEvent } from "react";
import ReactDOM from "react-dom";
import throttle from "lodash-es/throttle";
import debounce from "lodash-es/debounce";
import { ItemMeasure } from "./ItemMeasure";
import { wait } from "./utils";
import { trace } from "./trace";
import { Corrector } from "./Corrector";

const DEFAULT_ESTIMATED_HEIGHT = 50;
const SCROLL_THROTTLE_MS = 100;
const MEASURE_UPDATE_DEBOUNCE_MS = 50;
const SCROLL_DEBOUNCE_MS = 300;

// TODO: handle scrollTop negative
// TODO: comments and description and nuances

// TODO: heuristic function getEstimatedHeight(item, width) for better layouting
// TODO: logging system
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
  debugContainer?: HTMLElement | null;
  enabledDebugLayout?: boolean;
}

interface VirtualListState<Item> {
  startIndexToRender: number;
  stopIndexToRender: number;
  items: Item[];
}

interface CorrectedItemMetadata {
  index: number;
  correctedOffset: number;
  correctedHeight: number;
  correctedMeasured: boolean;
  originalMeasured: boolean;
  originalOffset: number;
  originalHeight: number;
  offsetDelta: number;
  heightDelta: number | null;
}

interface RenderRowProps<Item> {
  item: Item;
  ref: React.Ref<HTMLElement>;
  itemMetadata: CorrectedItemMetadata;
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
  anchorIndex: number | null;
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

interface GetInfoAboutNewItemsParams<Item extends Object> {
  prevItems: Item[];
  newItems: Item[];
  anchorIndex: number | null;
  anchorItem: Item | null;
  lastPositionedIndex: number;
}

interface StopIndexParams<Item extends Object> {
  items: Item[];
  startIndex: number;
  anchorIndex: number | null;
  offset: number;
  height: number;
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
  anchorIndex: number | null = null;
  containerRef = React.createRef<HTMLDivElement>();
  lastPositionedIndex: number = 0; // for debounce
  scrollingToIndex: number | null = null;
  isScrolling: boolean = false;
  corrector: Corrector = new Corrector();
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

  getCorrectedItemMetadata = (
    item: Item,
    index: number
  ): CorrectedItemMetadata => {
    this.ensureItemMetadata(item);

    const {
      height: originalHeight,
      offset: originalOffset,
      measured,
    } = this.getItemMetadata(item);

    const offsetDelta = this.corrector.getOffsetDelta(index);
    const heightDelta = this.corrector.getHeightDelta(index);

    return {
      index,
      correctedOffset: originalOffset + offsetDelta,
      correctedHeight:
        originalHeight + (heightDelta === null ? 0 : heightDelta),
      correctedMeasured: measured || heightDelta !== null,
      originalMeasured: measured,
      originalOffset,
      originalHeight,
      offsetDelta,
      heightDelta,
    };
  };

  /**
   * Build offsets for current view or needed index
   */
  buildItemsMetadata = ({
    items,
    height,
    offset,
    lastPositionedIndex,
    anchorIndex,
  }: BuildOffsetsOptions<Item>) => {
    const lastPositionedItem = items[lastPositionedIndex];

    // in case empty list
    if (!lastPositionedItem) {
      return {
        newStartIndexToRender: 0,
        newStopIndexToRender: -1,
        newLastPositionedIndex: 0,
        newAnchorItem: null,
        newAnchorIndex: null,
      };
    }

    const lastPositionedItemMetadata = this.getItemMetadata(lastPositionedItem);

    if (
      lastPositionedIndex >= items.length - 1 ||
      lastPositionedItemMetadata.offset > offset
    ) {
      // get start and calculate end
      const {
        startIndexToRender: newStartIndexToRender,
        anchorItem: newAnchorItem,
        anchorIndex: newAnchorIndex,
      } = this.getStartIndex(items, offset, lastPositionedIndex);

      const {
        stopIndexToRender: newStopIndexToRender,
        lastCalculatedIndex,
      } = this.calculateStopIndex({
        items,
        startIndex: newStartIndexToRender,
        anchorIndex,
        offset,
        height,
      });
      const newLastPositionedIndex = Math.max(
        lastPositionedIndex,
        lastCalculatedIndex
      );

      return {
        newStartIndexToRender,
        newStopIndexToRender,
        newLastPositionedIndex,
        newAnchorItem,
        newAnchorIndex,
      };
    }

    // get calculate start and end since lastPositionedIndex
    const {
      stopIndexToRender: newStopIndexToRender,
      lastCalculatedIndex,
    } = this.calculateStopIndex({
      items,
      startIndex: lastPositionedIndex,
      anchorIndex,
      offset,
      height,
    });
    const newLastPositionedIndex = Math.max(
      lastPositionedIndex,
      lastCalculatedIndex
    );

    const {
      startIndexToRender: newStartIndexToRender,
      anchorItem: newAnchorItem,
      anchorIndex: newAnchorIndex,
    } = this.getStartIndex(items, offset, newLastPositionedIndex);

    return {
      newStartIndexToRender,
      newStopIndexToRender,
      newLastPositionedIndex,
      newAnchorItem,
      newAnchorIndex,
    };
  };

  onScrollDebounced = debounce(() => {
    this.isScrolling = false;

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
      const currentOffset = this.getCorrectedItemMetadata(items[middle], middle)
        .correctedOffset;

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
      anchorIndex: nearestIndex,
      anchorItem: items[nearestIndex],
      startIndexToRender: Math.max(0, nearestIndex - 1),
    }; // for a11y +1 item upper}
  };

  calculateStopIndex = ({
    items,
    startIndex,
    anchorIndex,
    offset,
    height,
  }: StopIndexParams<Item>) => {
    const startItem = items[startIndex];
    const itemMetadata = this.getCorrectedItemMetadata(startItem, startIndex);
    const targetOffset = offset + height;

    let curOffsetCorrected =
      itemMetadata.correctedOffset + itemMetadata.correctedHeight;
    let curOffset = itemMetadata.originalOffset + itemMetadata.originalHeight;
    let stopIndex = startIndex;

    while (curOffsetCorrected < targetOffset && stopIndex < items.length - 1) {
      stopIndex++;
      const curItem = items[stopIndex];
      this.setItemMetadata(curItem, { offset: curOffset });
      const curItemMetadata = this.getCorrectedItemMetadata(curItem, stopIndex);
      curOffset += curItemMetadata.originalHeight;
      curOffsetCorrected += curItemMetadata.correctedHeight;
    }

    // for a11y +1 item
    if (stopIndex < items.length - 1) {
      stopIndex++;
      const curItem = items[stopIndex];
      this.setItemMetadata(curItem, { offset: curOffset });
      const curItemMetadata = this.getCorrectedItemMetadata(curItem, stopIndex);
      curOffset += curItemMetadata.originalHeight;
      curOffsetCorrected += curItemMetadata.correctedHeight;
    }

    const stopIndexToRender = stopIndex;

    // if we need to always calculated anchorIndex
    if (anchorIndex !== null && anchorIndex > stopIndex) {
      while (stopIndex < anchorIndex && stopIndex < items.length - 1) {
        stopIndex++;
        const curItem = items[stopIndex];
        this.setItemMetadata(curItem, { offset: curOffset });
        const curItemMetadata = this.getCorrectedItemMetadata(
          curItem,
          stopIndex
        );
        curOffset += curItemMetadata.originalHeight;
        curOffsetCorrected += curItemMetadata.correctedHeight;
      }
    }

    return {
      stopIndexToRender,
      lastCalculatedIndex: stopIndex,
    };
  };

  componentDidMount() {
    const { items, reversed, selectedItem } = this.props;

    let scrollPromise;
    if (selectedItem) {
      scrollPromise = this.scrollTo({
        item: selectedItem,
      });
    } else if (reversed) {
      scrollPromise = this.scrollTo({ index: items.length - 1 });
    }
    if (!scrollPromise) {
      return;
    }
    scrollPromise
      .then((scrollTop) => {
        console.log("Initial scrollTo finished", scrollTop);
      })
      .catch((error) => {
        console.error("Initial scrollTo error", error);
      });
  }

  getInfoAboutNewItems = ({
    prevItems,
    newItems,
    anchorItem,
    lastPositionedIndex,
  }: GetInfoAboutNewItemsParams<Item>) => {
    let newLastPositionedIndex = lastPositionedIndex;
    let newAnchorIndex = null;
    let newAnchorItem = null;
    let heightAddedBeforeAnchor = 0;

    for (let i = 0; i < newItems.length; i++) {
      const newItem = newItems[i];

      if (newItem !== prevItems[i] && i <= newLastPositionedIndex) {
        newLastPositionedIndex = Math.max(0, i - 1);
      }

      if (newItem === anchorItem) {
        newAnchorIndex = i;
        newAnchorItem = newItem;
        break;
      }

      const { created, meta } = this.ensureItemMetadata(newItem);

      if (created) {
        heightAddedBeforeAnchor += meta.height;
      }
    }

    return {
      newLastPositionedIndex,
      heightAddedBeforeAnchor,
      newAnchorIndex,
      newAnchorItem,
    };
  };

  adjustScrollTop = (scrollTopDelta: number) => {
    if (scrollTopDelta && this.containerRef.current) {
      this.containerRef.current.scrollTop += scrollTopDelta;
    }
  };

  canAdjustScrollTop = () => !this.isScrolling || this.offset === 0;

  componentDidUpdate(
    prevProps: Readonly<VirtualListProps<Item>>,
    prevState: Readonly<VirtualListState<Item>>
  ): void {
    trace(this.props, this.state, prevProps, prevState);

    const { items: newItems, height } = this.props;
    const { items: prevItems } = this.state;

    const { startIndexToRender, stopIndexToRender } = this.state;
    const anchorIndexBefore = this.anchorIndex;

    let curItems: Item[] = prevItems;
    let scrollTopDeltaByHeightCorrection = 0;

    if (this.canAdjustScrollTop() && this.corrector.isInitialized()) {
      this.lastPositionedIndex = this.corrector.getLastCorrectedIndex();
      const correctedHeightsMap = this.corrector.getHeightDeltaMap();
      correctedHeightsMap.forEach((correction, index) => {
        const { height } = this.getItemMetadata(curItems[index]);

        scrollTopDeltaByHeightCorrection += correction;

        this.setItemMetadata(curItems[index], {
          height: height + correction,
          measured: true,
        });
      });

      this.corrector.clear();
    }

    let scrollTopDeltaByAddedNew = 0;
    if (newItems !== prevItems && this.canAdjustScrollTop()) {
      const {
        newLastPositionedIndex,
        heightAddedBeforeAnchor,
        newAnchorIndex,
        newAnchorItem,
      } = this.getInfoAboutNewItems({
        prevItems,
        newItems,
        anchorItem: this.anchorItem,
        anchorIndex: this.anchorIndex,
        lastPositionedIndex: this.lastPositionedIndex,
      });

      this.lastPositionedIndex = newLastPositionedIndex;
      this.anchorIndex = newAnchorIndex;
      this.anchorItem = newAnchorItem;
      curItems = newItems;
      // don't adjust scroll in case anchor is disappeared
      scrollTopDeltaByAddedNew = !this.anchorItem ? 0 : heightAddedBeforeAnchor;
    }

    let stopIndexOffsetBefore = 0;
    if (stopIndexToRender >= 0) {
      stopIndexOffsetBefore = this.getCorrectedItemMetadata(
        curItems[stopIndexToRender],
        stopIndexToRender
      ).correctedOffset;
    }

    const scrollTopAdjustment =
      scrollTopDeltaByAddedNew + scrollTopDeltaByHeightCorrection;

    const {
      newStopIndexToRender,
      newStartIndexToRender,
      newLastPositionedIndex,
      newAnchorItem,
      newAnchorIndex,
    } = this.buildItemsMetadata({
      items: curItems,
      height,
      offset: this.offset + scrollTopAdjustment,
      lastPositionedIndex: this.lastPositionedIndex,
      anchorIndex: this.anchorIndex,
    });

    this.lastPositionedIndex = newLastPositionedIndex;
    this.anchorItem = newAnchorItem;
    this.anchorIndex = newAnchorIndex;

    let stopIndexOffsetAfter = 0;
    if (stopIndexToRender >= 0) {
      stopIndexOffsetAfter = this.getCorrectedItemMetadata(
        curItems[stopIndexToRender],
        stopIndexToRender
      ).correctedOffset;
    }

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
          this.adjustScrollTop(scrollTopAdjustment);
        }
      );
    } else if (
      scrollTopAdjustment ||
      stopIndexOffsetAfter !== stopIndexOffsetBefore ||
      this.anchorIndex !== anchorIndexBefore
    ) {
      this.forceUpdate(() => {
        this.adjustScrollTop(scrollTopAdjustment);
      });
    }
  }

  forceUpdateDebounced = debounce(() => {
    this.forceUpdate();
  }, MEASURE_UPDATE_DEBOUNCE_MS);

  onResize = (index: number, contentRect: DOMRectReadOnly) => {
    const { items } = this.state;

    const item = items[index];
    const { height: originalHeight } = this.getItemMetadata(item);
    const newHeight = Math.round(contentRect.height);

    if (newHeight === originalHeight) {
      return;
    }

    if (
      this.anchorIndex !== null &&
      index < this.anchorIndex &&
      !this.canAdjustScrollTop()
    ) {
      if (!this.corrector.isInitialized()) {
        this.corrector.init(this.lastPositionedIndex, 0);
        this.corrector.addNewHeightDelta(index, newHeight - originalHeight);
      } else if (index <= this.corrector.firstCorrectedIndex) {
        this.corrector.addNewHeightDelta(index, newHeight - originalHeight);
      }
    } else if (this.corrector.getHeightDeltaMap().has(index)) {
      this.corrector.addNewHeightDelta(index, newHeight - originalHeight);
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
    this.anchorIndex = index;
    this.anchorItem = this.props.items[index] || null;

    await this.forceUpdateAsync(); // wait for building new metadata by buildItemsMetadata

    const { items: itemsProps, height, estimatedItemHeight } = this.props;
    const { items: itemsState } = this.state;

    if (itemsProps !== itemsState) {
      throw new Error(
        "Items from props have not been applied yet because list is scrolling and is using corrected offsets"
      );
    }

    const {
      correctedOffset,
      correctedMeasured,
    } = this.getCorrectedItemMetadata(itemsProps[index], index);
    const containerHeight = this.getEstimatedTotalHeight(
      itemsProps,
      estimatedItemHeight,
      this.lastPositionedIndex
    );
    const maxPossibleOffset = Math.max(0, containerHeight - height);
    const newOffset = Math.min(maxPossibleOffset, correctedOffset);

    if (correctedMeasured && this.offset === newOffset) {
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

  getItemsToRender = () => {
    const { renderRow, getItemKey, enabledDebugLayout } = this.props;
    const { items, startIndexToRender, stopIndexToRender } = this.state;

    const itemsToRender = [];

    for (let i = startIndexToRender; i <= stopIndexToRender; i++) {
      const item = items[i];
      const itemMetadata = this.getCorrectedItemMetadata(item, i);

      itemsToRender.push(
        <ItemMeasure key={getItemKey(item)} onResize={this.onResize} index={i}>
          {({ measureRef }) => {
            const top = itemMetadata.correctedOffset;
            const curHeight = itemMetadata.correctedHeight;
            const style: CSSProperties = {
              position: "absolute",
              top,
              height: curHeight,
              opacity: itemMetadata.correctedMeasured ? 1 : 0,
              width: "100%",
            };

            if (enabledDebugLayout) {
              style.backgroundColor =
                this.anchorItem === item
                  ? "pink"
                  : itemMetadata.offsetDelta
                  ? "yellow"
                  : "transparent";
              style.opacity = style.opacity === 0 ? 0.1 : 1;
            }

            return (
              <div style={style}>
                {renderRow({
                  ref: measureRef,
                  item,
                  itemMetadata,
                })}
              </div>
            );
          }}
        </ItemMeasure>
      );
    }

    return itemsToRender;
  };

  getDebugInfo = () => {
    const { debugContainer } = this.props;
    const { startIndexToRender, stopIndexToRender } = this.state;

    return (
      debugContainer &&
      ReactDOM.createPortal(
        <div
          style={{
            display: "flex",
            flexDirection: "column",
          }}
        >
          <span>startIndexToRender: {startIndexToRender}</span>
          <span>stopIndexToRender: {stopIndexToRender}</span>
          <span>offset: {this.offset}</span>
          <span>
            anchorItemIndex: {this.anchorItem && (this.anchorItem as any).index}
          </span>
          <span>lastPositionedIndex: {this.lastPositionedIndex}</span>
          <span>scrollingToIndex: {this.scrollingToIndex}</span>
          <span>isScrolling: {this.isScrolling ? "true" : "false"}</span>
          <span>
            scrollingDirection: {this.scrollingDirection ? "down" : "up"}
          </span>
        </div>,
        debugContainer
      )
    );
  };

  render() {
    const { height, width, estimatedItemHeight, reversed } = this.props;
    const { items } = this.state;

    const estimatedTotalHeight = this.getEstimatedTotalHeight(
      items,
      estimatedItemHeight,
      this.lastPositionedIndex
    );

    const itemsToRender = this.getItemsToRender();
    const debugInfo = this.getDebugInfo();

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
          {debugInfo}
        </div>
      </div>
    );
  }
}
