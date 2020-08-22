import React, { CSSProperties, UIEvent } from "react";
import throttle from "lodash-es/throttle";
import debounce from "lodash-es/debounce";

import { ItemMeasure } from "./ItemMeasure";
import { wait } from "../utils";
import { traceDU } from "../ChatViewer/traceDU";
import { Corrector } from "./Corrector";

const DEFAULT_ESTIMATED_HEIGHT = 100;
const SCROLL_THROTTLE_MS = 100;
const MEASURE_UPDATE_DEBOUNCE_MS = 50;
const SCROLL_DEBOUNCE_MS = 300;

// TODO: supprot heuristic function getEstimatedHeight(item, width) for better layouting
// TODO: logging system
// TODO: tests

/**
 * VirtualList can virtualize huge lists with dynamic height.
 * It anchors to the top element in the current view. It uses ResizeObserver for detecting changes in heights.
 * Inspired by react-window.
 *
 * There are some caveats except described below. Items from props may be applied with delay.
 * They are applied only when scroll is idle. This is the limitation of the correction technique that is used here.
 * This technique relies on consistent indexes to calculate corrected offsets.
 * scrollTo - is async function because we measure items on the fly.
 *
 * Related issues and discussions:
 * - https://github.com/bvaughn/react-window/issues/6
 * - https://github.com/bvaughn/react-virtualized/issues/610#issuecomment-324890558
 *
 */

interface VirtualListProps<Item> {
  height: number;
  width: number;
  getItemKey: (item: Item) => string;
  approximateItemHeight: number;
  renderRow: (renderRowProps: RenderRowProps<Item>) => React.ReactNode;
  reversed: boolean; // if the list is stick to the bottom
  items: Item[];
  selectedItem: Item;
  debug?: boolean;
  onScroll?: (params: OnScrollEvent<Item>) => void; // fire on scroll only on meaningful scrolls
}

interface VirtualListState<Item> {
  startIndexToRender: number;
  stopIndexToRender: number;
  items: Item[];
  estimatedTotalHeight: number;
}

export interface OnScrollEvent<Item> {
  items: Item[];
  startIndexToRender: number;
  stopIndexToRender: number;
  calculatedMiddleIndexToRender: number;
  offset: number;
  maxPossibleScrollTop: number;
  anchorItem: Item | null;
  anchorIndex: number | null;
  lastPositionedIndex: number;
  scrollingToIndex: number | null;
  isScrolling: boolean;
  scrollingDirection: ScrollingDirection;
  totalHeight: number;
  isAtTheBottom: boolean;
  isAtTheTop: boolean;
  height: number;
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

export interface RenderRowProps<Item> {
  item: Item;
  ref: React.Ref<HTMLDivElement>;
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
  indexMustBeCalculated: number;
}

enum ScrollingDirection {
  up,
  down,
}

interface GetInfoAboutNewItemsParams<Item extends Object> {
  prevItems: Item[];
  newItems: Item[];
  anchorItem: Item | null;
  lastPositionedIndex: number;
}

interface StopIndexParams<Item extends Object> {
  items: Item[];
  startIndex: number;
  anchorIndex: number | null;
  offset: number;
  height: number;
  indexMustBeCalculated: number;
}

interface EstimatedTotalHeightParams<Item extends Object> {
  lastPositionedItem: Item;
  lastPositionedIndex: number;
  itemsCount: number;
  approximateItemHeight: number;
}

export class VirtualList<Item extends Object> extends React.PureComponent<
  VirtualListProps<Item>,
  VirtualListState<Item>
> {
  static defaultProps = {
    approximateItemHeight: DEFAULT_ESTIMATED_HEIGHT,
    reversed: false,
    selectedItem: null,
  };

  state = {
    startIndexToRender: 0, // startIndex for virtual window to render
    stopIndexToRender: -1, // stopIndex for virtual window to render
    items: [],
    estimatedTotalHeight: 0,
  };

  itemKeyToMetadata: Map<string, ItemMetadata> = new Map<
    string,
    ItemMetadata
  >();
  offset: number = 0; // scrollTop of the container
  anchorItem: Item | null = null;
  anchorIndex: number | null = null;
  containerRef = React.createRef<HTMLDivElement>();
  // for this index and all indexes below we know offsets. Also we know heights but some of them might be not measured yet
  lastPositionedIndex: number = 0;
  scrollingToItem: Item | null = null;
  scrollingToIndex: number | null = null;
  isScrolling: boolean = false;
  corrector: Corrector = new Corrector();
  scrollingDirection: ScrollingDirection = ScrollingDirection.down;
  inited: boolean = false;
  isAtTheTop: boolean = false;
  isAtTheBottom: boolean = false;

  ensureItemMetadata = (itemKey: string) => {
    const { approximateItemHeight } = this.props;

    if (!this.itemKeyToMetadata.has(itemKey)) {
      const meta = {
        height: approximateItemHeight,
        offset: 0,
        measured: false,
      };
      this.itemKeyToMetadata.set(itemKey, meta);

      return {
        meta,
        created: true,
      };
    }

    return {
      meta: this.itemKeyToMetadata.get(itemKey)!,
      created: false,
    };
  };

  setItemMetadata = (item: Item, newMeta: Partial<ItemMetadata>) => {
    const { getItemKey } = this.props;
    const key = getItemKey(item);
    this.ensureItemMetadata(key);

    const meta = this.itemKeyToMetadata.get(key)!;

    this.itemKeyToMetadata.set(key, { ...meta, ...newMeta });
  };

  getItemMetadata = (item: Item) => {
    const { getItemKey } = this.props;
    const key = getItemKey(item);
    this.ensureItemMetadata(key);

    return this.itemKeyToMetadata.get(key)!;
  };

  getCorrectedItemMetadata = (
    item: Item,
    index: number
  ): CorrectedItemMetadata => {
    const { getItemKey } = this.props;
    const key = getItemKey(item);
    this.ensureItemMetadata(key);

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
   * Build offsets for current view, needed index and anchorIndex and get new state values
   */
  buildItemsMetadata = ({
    items,
    height,
    offset,
    lastPositionedIndex,
    anchorIndex,
    indexMustBeCalculated,
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
      // we've already built layout for this offset and we can get startIndex
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
        indexMustBeCalculated,
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

    // We don't know layout for requested offset and have to build it. We can start from lastPositionedIndex
    const {
      stopIndexToRender: newStopIndexToRender,
      lastCalculatedIndex,
    } = this.calculateStopIndex({
      items,
      startIndex: lastPositionedIndex,
      anchorIndex,
      offset,
      height,
      indexMustBeCalculated,
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

  callOnScrollHandler = () => {
    const { onScroll, height, items: newItems } = this.props;
    const {
      items: prevItems,
      stopIndexToRender,
      startIndexToRender,
      estimatedTotalHeight,
    } = this.state;

    this.isAtTheTop = this.offset === 0 && this.anchorIndex === 0;
    this.isAtTheBottom =
      this.offset === this.getMaximumPossibleOffset() &&
      this.lastPositionedIndex === newItems.length - 1;

    if (
      newItems === prevItems &&
      onScroll &&
      this.inited &&
      this.scrollingToItem === null
    ) {
      // don't call onScroll while scrolling to item or during initialization
      onScroll({
        isAtTheTop: this.isAtTheTop,
        isAtTheBottom: this.isAtTheBottom,
        lastPositionedIndex: this.lastPositionedIndex,
        scrollingDirection: this.scrollingDirection,
        isScrolling: this.isScrolling,
        startIndexToRender,
        stopIndexToRender,
        calculatedMiddleIndexToRender:
          startIndexToRender +
          Math.round((stopIndexToRender - startIndexToRender) / 2),
        items: newItems,
        anchorIndex: this.anchorIndex,
        anchorItem: this.anchorItem,
        height: height,
        offset: this.offset,
        maxPossibleScrollTop: this.getMaximumPossibleOffset(),
        scrollingToIndex: this.scrollingToItem,
        totalHeight: estimatedTotalHeight,
      });
    }
  };

  onScrollDebounced = debounce(() => {
    this.isScrolling = false;

    this.callOnScrollHandler();

    this.forceUpdate();
  }, SCROLL_DEBOUNCE_MS);

  onScrollThrottled = throttle((scrollTop: number) => {
    this.scrollingDirection =
      scrollTop <= this.offset
        ? ScrollingDirection.up
        : ScrollingDirection.down;
    this.offset = Math.round(scrollTop);
    this.isScrolling = true;

    this.callOnScrollHandler();
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
      startIndexToRender: Math.max(0, nearestIndex - 1), // for a11y +1 item upper
    };
  };

  calculateStopIndex = ({
    items,
    startIndex,
    anchorIndex,
    offset,
    height,
    indexMustBeCalculated,
  }: StopIndexParams<Item>) => {
    const startItem = items[startIndex];
    const itemMetadata = this.getCorrectedItemMetadata(startItem, startIndex);
    const targetOffset = offset + height;

    // TRICKY: During calculation we calculate offsets with corrections but we set original offsets
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
    let calculateUntil = indexMustBeCalculated;
    if (anchorIndex !== null && anchorIndex > calculateUntil) {
      calculateUntil = anchorIndex;
    }

    // we have to always calculate anchorIndex or indexMustBeCalculated
    if (calculateUntil > stopIndex) {
      while (stopIndex < calculateUntil && stopIndex < items.length - 1) {
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

    const markAsInitedAndCallHandler = () => {
      this.inited = true;
      this.callOnScrollHandler();
      this.forceUpdate();
    };

    let scrollPromise;
    if (selectedItem) {
      scrollPromise = this.scrollTo(selectedItem);
    } else if (reversed) {
      scrollPromise = this.scrollTo(items[items.length - 1]);
    }
    if (scrollPromise) {
      scrollPromise
        .then((scrollTop) => {
          console.log("Initial scrollTo finished", scrollTop);
        })
        .catch((error) => {
          console.error("Initial scrollTo error", error);
        })
        .finally(markAsInitedAndCallHandler);
    } else {
      markAsInitedAndCallHandler();
    }
  }

  getInfoAboutNewItems = ({
    prevItems,
    newItems,
    anchorItem,
    lastPositionedIndex,
  }: GetInfoAboutNewItemsParams<Item>) => {
    const { getItemKey } = this.props;
    let newLastPositionedIndex = lastPositionedIndex;
    let newAnchorIndex = null;
    let newAnchorItem = null;
    let heightAddedBeforeAnchor = 0;

    for (let i = 0; i < newItems.length; i++) {
      const newItem = newItems[i];
      const newItemKey = getItemKey(newItem);

      if (
        (!prevItems[i] || newItemKey !== getItemKey(prevItems[i])) &&
        i <= newLastPositionedIndex
      ) {
        // until what index items were not changed
        newLastPositionedIndex = Math.max(0, i - 1);
      }

      if (anchorItem && newItemKey === getItemKey(anchorItem)) {
        // found our anchor in new items
        newAnchorIndex = i;
        newAnchorItem = newItem;
        break;
      }

      // to keep positions after prepend we have to calculate newly added items heights
      const { created, meta } = this.ensureItemMetadata(newItemKey);
      if (created) {
        heightAddedBeforeAnchor += meta.height;
      }
    }

    return {
      // if there is no anchor in new list then we reset lastPositionedIndex
      newLastPositionedIndex: Math.min(
        newLastPositionedIndex,
        newAnchorIndex === null ? 0 : newAnchorIndex
      ),
      heightAddedBeforeAnchor,
      newAnchorIndex,
      newAnchorItem,
    };
  };

  /**
   * Can be applied only on idle to make scrolling smooth
   */
  adjustScrollTop = (scrollTopDelta: number) => {
    if (scrollTopDelta && this.containerRef.current) {
      console.log("adjustScrollTop", scrollTopDelta);
      this.containerRef.current.scrollTop += scrollTopDelta;
    }
  };

  /**
   *
   */
  canAdjustScrollTop = () => {
    const { approximateItemHeight } = this.props;

    return (
      !this.isScrolling ||
      this.offset < approximateItemHeight ||
      this.getMaximumPossibleOffset() - this.offset < approximateItemHeight
    );
  };

  componentDidUpdate(
    prevProps: Readonly<VirtualListProps<Item>>,
    prevState: Readonly<VirtualListState<Item>>
  ): void {
    const {
      items: newItems,
      height,
      approximateItemHeight,
      debug,
    } = this.props;

    const {
      items: prevItems,
      estimatedTotalHeight,
      startIndexToRender,
      stopIndexToRender,
    } = this.state;

    if (debug) {
      traceDU(this.props, this.state, prevProps, prevState);
    }

    let curItems: Item[] = prevItems;
    const indexMustBeCalculated =
      this.scrollingToIndex === null ? 0 : this.scrollingToIndex;
    const anchorIndexBefore = this.anchorIndex;
    const anchorItemBefore = this.anchorItem;
    let anchorOffsetBefore = null;
    if (anchorIndexBefore !== null && curItems[anchorIndexBefore]) {
      anchorOffsetBefore = this.getCorrectedItemMetadata(
        curItems[anchorIndexBefore],
        anchorIndexBefore
      ).correctedOffset;
    }
    let stopIndexOffsetBefore = 0;
    if (curItems[stopIndexToRender]) {
      stopIndexOffsetBefore = this.getCorrectedItemMetadata(
        curItems[stopIndexToRender],
        stopIndexToRender
      ).correctedOffset;
    }

    if (this.canAdjustScrollTop() && this.corrector.isInitialized()) {
      // if we used corrector and now can adjust scrollTop
      this.lastPositionedIndex = this.corrector.lastCorrectedIndex;
      const correctedHeightsMap = this.corrector.indexToHeightDeltaMap;
      // apply measured heights during corrected phase
      correctedHeightsMap.forEach((correction, index) => {
        const { height } = this.getItemMetadata(curItems[index]);
        this.setItemMetadata(curItems[index], {
          height: height + correction,
          measured: true,
        });
      });
      this.corrector.clear();
    }

    let heightAddedBeforeAnchorWithNewItems = 0;
    if (newItems !== prevItems && this.canAdjustScrollTop()) {
      // items were changed during scrolling. Now we can apply new items
      const {
        newLastPositionedIndex,
        newAnchorIndex,
        newAnchorItem,
        heightAddedBeforeAnchor,
      } = this.getInfoAboutNewItems({
        prevItems,
        newItems,
        anchorItem: this.anchorItem,
        lastPositionedIndex: this.lastPositionedIndex,
      });

      heightAddedBeforeAnchorWithNewItems = heightAddedBeforeAnchor;
      this.lastPositionedIndex = newLastPositionedIndex;
      this.anchorIndex = newAnchorIndex;
      this.anchorItem = newAnchorItem;
      curItems = newItems;
    }

    let newState;
    newState = this.buildItemsMetadata({
      items: curItems,
      height,
      offset: this.offset,
      lastPositionedIndex: this.lastPositionedIndex,
      anchorIndex: this.anchorIndex,
      indexMustBeCalculated,
    });

    let anchorOffsetAfter = null;
    if (this.anchorIndex !== null && curItems[this.anchorIndex]) {
      anchorOffsetAfter = this.getCorrectedItemMetadata(
        curItems[this.anchorIndex],
        this.anchorIndex
      ).correctedOffset;
    }
    let stopIndexOffsetAfter = 0;
    if (curItems[stopIndexToRender]) {
      stopIndexOffsetAfter = this.getCorrectedItemMetadata(
        curItems[stopIndexToRender],
        stopIndexToRender
      ).correctedOffset;
    }

    let scrollTopAdjustment = 0;
    if (
      anchorItemBefore !== null &&
      this.anchorItem === null &&
      heightAddedBeforeAnchorWithNewItems
    ) {
      // in case anchor was removed
      scrollTopAdjustment =
        heightAddedBeforeAnchorWithNewItems -
        this.getItemMetadata(anchorItemBefore).height;
    } else if (
      anchorOffsetBefore !== null &&
      anchorOffsetAfter !== null &&
      anchorOffsetBefore - anchorOffsetAfter !== 0
    ) {
      // anchor offset was changed
      scrollTopAdjustment = anchorOffsetAfter - anchorOffsetBefore;
    }

    if (scrollTopAdjustment) {
      // we know future adjustment and calculate newState ahead of time
      newState = this.buildItemsMetadata({
        items: curItems,
        height,
        offset: this.offset + scrollTopAdjustment,
        lastPositionedIndex: newState.newLastPositionedIndex,
        anchorIndex: this.anchorIndex,
        indexMustBeCalculated,
      });
    }

    this.lastPositionedIndex = newState.newLastPositionedIndex;
    this.anchorItem = newState.newAnchorItem;
    this.anchorIndex = newState.newAnchorIndex;
    const newEstimatedTotalHeight = this.getEstimatedTotalHeight({
      lastPositionedIndex: this.lastPositionedIndex,
      lastPositionedItem: curItems[this.lastPositionedIndex],
      approximateItemHeight,
      itemsCount: curItems.length,
    });

    if (
      startIndexToRender !== newState.newStartIndexToRender ||
      stopIndexToRender !== newState.newStopIndexToRender ||
      curItems !== prevItems ||
      newEstimatedTotalHeight !== estimatedTotalHeight
    ) {
      this.setState(
        {
          startIndexToRender: newState.newStartIndexToRender,
          stopIndexToRender: newState.newStopIndexToRender,
          items: curItems,
          estimatedTotalHeight: newEstimatedTotalHeight,
        },
        () => {
          this.adjustScrollTop(scrollTopAdjustment);
        }
      );
    } else if (
      scrollTopAdjustment ||
      this.anchorIndex !== anchorIndexBefore ||
      stopIndexOffsetAfter !== stopIndexOffsetBefore
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

    console.log("onResize", {
      index,
      originalHeight,
      newHeight,
    });

    if (
      this.anchorIndex !== null &&
      index < this.anchorIndex &&
      !this.canAdjustScrollTop()
    ) {
      // there are changes in heights upper than our anchor and we can't adjust scrollTop at the moment
      if (!this.corrector.isInitialized()) {
        this.corrector.init(this.lastPositionedIndex, 0); // for this position there is no corrections
        this.corrector.addNewHeightDelta(index, newHeight - originalHeight);
      } else if (index <= this.corrector.firstCorrectedIndex) {
        this.corrector.addNewHeightDelta(index, newHeight - originalHeight);
      }
    } else if (this.corrector.indexToHeightDeltaMap.has(index)) {
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

  getEstimatedTotalHeight = ({
    lastPositionedItem,
    lastPositionedIndex,
    itemsCount,
    approximateItemHeight,
  }: EstimatedTotalHeightParams<Item>) => {
    if (itemsCount === 0) {
      return 0;
    }

    const lastPositionedItemMetadata = this.getCorrectedItemMetadata(
      lastPositionedItem,
      lastPositionedIndex
    );

    return (
      lastPositionedItemMetadata.correctedOffset +
      lastPositionedItemMetadata.correctedHeight +
      (itemsCount - 1 - this.lastPositionedIndex) * approximateItemHeight
    );
  };

  forceUpdateAsync = () =>
    new Promise((resolve) => {
      this.forceUpdate(resolve);
    });

  getIndexByItem = (item: Item) => {
    const { getItemKey } = this.props;
    const index = this.props.items.findIndex(
      (i) => getItemKey(i) === getItemKey(item)
    );
    if (index === -1) {
      return null;
    }
    return index;
  };

  getMaximumPossibleOffset = () => {
    const { height } = this.props;
    const { estimatedTotalHeight } = this.state;

    if (!this.containerRef.current) {
      return 0;
    }

    return Math.max(0, estimatedTotalHeight - height);
  };

  scrollTo = async (item: Item, retries: number = 5): Promise<number> => {
    const { getItemKey, items: propsItems } = this.props;
    const { items: stateItems } = this.state;

    if (
      this.scrollingToItem !== null &&
      getItemKey(this.scrollingToItem) !== getItemKey(item)
    ) {
      console.warn(
        `Already scrolling to item: ${this.scrollingToItem}, but got item: ${item}. It is ignored`
      );
    }

    let index =
      this.scrollingToIndex === null
        ? this.getIndexByItem(item)
        : this.scrollingToIndex;
    console.log("scrollTo", item, index, retries);

    if (index === null) {
      this.scrollingToItem = null;
      this.scrollingToIndex = null;
      throw new Error(`There is no such item in the list, ${item}`);
    }

    if (!this.containerRef.current) {
      this.scrollingToItem = null;
      this.scrollingToIndex = null;
      throw new Error("Container is not initialized yet");
    }

    if (
      stateItems.length !== propsItems.length ||
      getItemKey(stateItems[index]) !== getItemKey(propsItems[index])
    ) {
      // wait for sync between props and state
      await this.forceUpdateAsync();
      await wait(SCROLL_THROTTLE_MS * 2);
      return this.scrollTo(item, retries - 1);
    }

    // cDU knows about it
    this.scrollingToItem = item;
    this.scrollingToIndex = index;

    await this.forceUpdateAsync(); // wait for building new metadata by buildItemsMetadata

    if (
      stateItems.length !== propsItems.length ||
      getItemKey(this.state.items[index]) !==
        getItemKey(this.props.items[index])
    ) {
      // wait for sync between props and state
      await this.forceUpdateAsync();
      await wait(SCROLL_THROTTLE_MS * 2);
      return this.scrollTo(item, retries - 1);
    }

    const {
      correctedOffset,
      correctedMeasured,
    } = this.getCorrectedItemMetadata(this.props.items[index], index);
    const newOffset = Math.min(
      this.getMaximumPossibleOffset(),
      correctedOffset
    );

    if (correctedMeasured && this.offset === newOffset) {
      this.scrollingToItem = null;
      this.scrollingToIndex = null;
      return this.offset;
    } else if (retries <= 0) {
      this.scrollingToItem = null;
      this.scrollingToIndex = null;
      throw new Error(`Could not scroll to index ${index}. No retries left`);
    }

    this.containerRef.current.scrollTop = newOffset;

    await wait(SCROLL_THROTTLE_MS * 2); // wait for state.offset to be changed by scroll

    return this.scrollTo(item, retries - 1);
  };

  getItemsToRender = () => {
    const { renderRow, getItemKey, debug } = this.props;
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

            if (debug) {
              style.backgroundColor =
                this.anchorItem === item
                  ? "pink"
                  : itemMetadata.offsetDelta
                  ? "yellow"
                  : "transparent";
              style.opacity = style.opacity === 0 ? 0.2 : 1;
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
    const { debug, width, height } = this.props;
    const {
      startIndexToRender,
      stopIndexToRender,
      estimatedTotalHeight,
    } = this.state;

    return (
      debug && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            position: "absolute",
            right: -width,
            top: height / 4,
            zIndex: 2,
            backgroundColor: "black",
            color: "white",
            width: 180,
          }}
        >
          <span>startIndexToRender: {startIndexToRender}</span>
          <span>stopIndexToRender: {stopIndexToRender}</span>
          <span>offset: {this.offset}</span>
          <span>anchorIndex: {this.anchorIndex}</span>
          <span>lastPositionedIndex: {this.lastPositionedIndex}</span>
          <span>
            scrollingToIndex: {this.scrollingToIndex && this.scrollingToIndex}
          </span>
          <span>isScrolling: {this.isScrolling ? "true" : "false"}</span>
          <span>
            scrollingDirection: {this.scrollingDirection ? "down" : "up"}
          </span>
          <span>inited: {this.inited ? "true" : "false"}</span>
          <span>totalHeight: {estimatedTotalHeight}</span>
          <span>isAtTheTop: {this.offset === 0 ? "true" : "false"}</span>
          <span>
            isAtTheBottom:{" "}
            {this.offset === this.getMaximumPossibleOffset() ? "true" : "false"}
          </span>
        </div>
      )
    );
  };

  render() {
    const { height, width, reversed } = this.props;
    const { estimatedTotalHeight } = this.state;

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
        {debugInfo}
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
      </div>
    );
  }
}
