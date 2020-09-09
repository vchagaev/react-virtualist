import React from "react";
import debounce from "lodash-es/debounce";

import { onResizeFn } from "./ItemMeasure";
import { traceDU } from "../ChatViewer/traceDU";
import { Corrector } from "./Corrector";
import { Row } from "./Row";
import { Containers } from "./Containers";
import { Scroller } from "./Scroller";
import { findNearestItemBinarySearch } from "./findNearestBinarySearch";
import {
  BuildOffsetsOptions,
  CorrectedItemMetadata,
  EstimatedTotalHeightParams,
  GetInfoAboutNewItemsParams,
  ItemMetadata,
  StopIndexParams,
  VirtualListProps,
  VirtualListState,
} from "./types";
import {
  DEFAULT_ESTIMATED_HEIGHT,
  DEFAULT_OFFSCREEN_ITEMS_HEIGHT_RATIO, MEASURE_UPDATE_DEBOUNCE_MS,
  SCROLL_DEBOUNCE_MS,
  SCROLL_THROTTLE_MS
} from './constants'

export class VirtualList<Item extends Object> extends React.PureComponent<
  VirtualListProps<Item>,
  VirtualListState<Item>
> {
  static defaultProps = {
    approximateItemHeight: DEFAULT_ESTIMATED_HEIGHT,
    reversed: false,
    selectedItem: null,
    offscreenRatio: DEFAULT_OFFSCREEN_ITEMS_HEIGHT_RATIO,
    debug: false,
  };

  state = {
    startIndexToRender: 0, // startIndex for virtual window to render
    stopIndexToRender: -1, // stopIndex for virtual window to render
    items: this.props.items,
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
  isScrolling: boolean = false;
  corrector: Corrector = new Corrector();
  inited: boolean = false;

  forceUpdateAsync = (): Promise<void> =>
    new Promise((resolve) => {
      this.forceUpdate(() => resolve());
    });

  getMaximumPossibleOffset = () => {
    const { height } = this.props;
    const { estimatedTotalHeight } = this.state;

    if (!this.containerRef.current) {
      return 0;
    }

    return Math.max(0, estimatedTotalHeight - height);
  };

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

  scroller: Scroller<Item> = new Scroller<Item>(
    this.props.getItemKey,
    SCROLL_THROTTLE_MS * 2,
    this.getCorrectedItemMetadata,
    this.forceUpdateAsync,
    this.getMaximumPossibleOffset
  );

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
    offscreenRatio,
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
      const { startIndexToRender: newStartIndexToRender } = this.getStartIndex(
        items,
        offset,
        lastPositionedIndex,
        height,
        offscreenRatio
      );

      const {
        stopIndexToRender: newStopIndexToRender,
        lastCalculatedIndex,
        newAnchorItem,
        newAnchorIndex,
      } = this.calculateStopIndexAndAnchor({
        items,
        startIndex: newStartIndexToRender,
        anchorIndex,
        offset,
        height,
        indexMustBeCalculated,
        offscreenRatio,
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
      newAnchorItem,
      newAnchorIndex,
    } = this.calculateStopIndexAndAnchor({
      items,
      startIndex: lastPositionedIndex,
      anchorIndex,
      offset,
      height,
      indexMustBeCalculated,
      offscreenRatio,
    });
    const newLastPositionedIndex = Math.max(
      lastPositionedIndex,
      lastCalculatedIndex
    );

    const { startIndexToRender: newStartIndexToRender } = this.getStartIndex(
      items,
      offset,
      newLastPositionedIndex,
      height,
      offscreenRatio
    );

    return {
      newStartIndexToRender,
      newStopIndexToRender,
      newLastPositionedIndex,
      newAnchorItem,
      newAnchorIndex,
    };
  };

  callOnScrollHandler = () => {
    const { onScroll, items: newItems } = this.props;
    const {
      items: prevItems,
      stopIndexToRender,
      startIndexToRender,
    } = this.state;

    if (
      newItems === prevItems &&
      onScroll &&
      this.inited &&
      this.scroller.scrollingToItem === null
    ) {
      // don't call onScroll while scrolling to item or during initialization
      onScroll({
        calculatedMiddleIndexToRender:
          startIndexToRender +
          Math.round((stopIndexToRender - startIndexToRender) / 2),
        items: newItems,
      });
    }
  };

  onScrollDebounced = debounce(() => {
    this.isScrolling = false;

    this.callOnScrollHandler();

    this.forceUpdate();
  }, SCROLL_DEBOUNCE_MS);

  onScroll = (normalizedScrollTop: number) => {
    this.isScrolling = true;
    this.offset = normalizedScrollTop;
    this.callOnScrollHandler();
    this.onScrollDebounced();

    this.forceUpdate();
  };

  getStartIndex = (
    items: Item[],
    offset: number,
    lastPositionedIndex: number,
    height: number,
    offsetRatio: number
  ) => {
    const nearestIndex = findNearestItemBinarySearch(
      items,
      offset - height * offsetRatio, // for better virtualization
      lastPositionedIndex,
      this.getCorrectedItemMetadata
    );

    return {
      startIndexToRender: Math.max(0, nearestIndex - 1), // for a11y +1 item upper
    };
  };

  calculateStopIndexAndAnchor = ({
    items,
    startIndex,
    anchorIndex,
    offset,
    height,
    indexMustBeCalculated,
    offscreenRatio,
  }: StopIndexParams<Item>) => {
    let newAnchorItem = null;
    let newAnchorIndex = null;
    const startItem = items[startIndex];
    const itemMetadata = this.getCorrectedItemMetadata(startItem, startIndex);
    const targetOffset = offset + height + height * offscreenRatio;

    // TRICKY: During calculation we calculate offsets with corrections but we set original offsets
    let curOffsetCorrected =
      itemMetadata.correctedOffset + itemMetadata.correctedHeight;
    let curOffset = itemMetadata.originalOffset + itemMetadata.originalHeight;
    let stopIndex = startIndex;

    if (
      (itemMetadata.correctedOffset + itemMetadata.correctedHeight >= offset ||
        itemMetadata.correctedOffset >= offset) &&
      itemMetadata.correctedMeasured
    ) {
      newAnchorItem = items[stopIndex];
      newAnchorIndex = stopIndex;
    }

    while (curOffsetCorrected < targetOffset && stopIndex < items.length - 1) {
      stopIndex++;
      const curItem = items[stopIndex];
      this.setItemMetadata(curItem, { offset: curOffset });
      const curItemMetadata = this.getCorrectedItemMetadata(curItem, stopIndex);

      if (
        (curItemMetadata.correctedOffset + curItemMetadata.correctedHeight >=
          offset ||
          curItemMetadata.correctedOffset >= offset) &&
        curItemMetadata.correctedMeasured &&
        !newAnchorItem
      ) {
        newAnchorItem = curItem;
        newAnchorIndex = stopIndex;
      }

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
      newAnchorItem,
      newAnchorIndex,
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
      this.containerRef.current.style.overflow = "hidden"; // to stop safari inertia
      this.containerRef.current.scrollTop += scrollTopDelta;
      this.offset = this.containerRef.current.scrollTop;
      this.containerRef.current.style.overflow = "auto";
    }
  };

  /**
   * Check if we can apply scrollTop
   */
  canAdjustScrollTop = () => {
    return (
      !this.isScrolling ||
      this.offset === 0 ||
      this.offset === this.getMaximumPossibleOffset()
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
      offscreenRatio,
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
      this.scroller.scrollingToIndex === null
        ? 0
        : this.scroller.scrollingToIndex;
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
      offscreenRatio,
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
        offscreenRatio,
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

  onResize: onResizeFn = (index: number, contentRect: DOMRectReadOnly) => {
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

  scrollTo = (item: Item): Promise<number> => {
    const { items: propsItems } = this.props;

    return this.scroller.scrollToItem({
      item: item,
      items: propsItems,
      container: this.containerRef.current,
    });
  };

  getRowsToRender = () => {
    const { renderRow, getItemKey, debug } = this.props;
    const { items, startIndexToRender, stopIndexToRender } = this.state;

    const itemsToRender = [];

    for (let i = startIndexToRender; i <= stopIndexToRender; i++) {
      const item = items[i];
      const itemMetadata = this.getCorrectedItemMetadata(item, i);

      itemsToRender.push(
        <Row<Item>
          key={getItemKey(item)}
          item={item}
          anchorItem={this.anchorItem}
          debug={debug}
          index={i}
          itemMetadata={itemMetadata}
          renderRow={renderRow}
          onResize={this.onResize}
        />
      );
    }

    return itemsToRender;
  };

  render() {
    const { height, width, reversed, debug } = this.props;
    const { estimatedTotalHeight } = this.state;

    return (
      <Containers
        rows={this.getRowsToRender()}
        height={height}
        width={width}
        debug={debug}
        onScroll={this.onScroll}
        estimatedTotalHeight={estimatedTotalHeight}
        containerRef={this.containerRef}
        reversed={reversed}
        instance={this}
        scrollThrottle={SCROLL_THROTTLE_MS}
      />
    );
  }
}
