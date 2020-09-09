import React from 'react'

export type GetItemKeyFn<Item> = (item: Item) => string;
export type RenderRowFn<Item> = (
  renderRowProps: RenderRowProps<Item>
) => React.ReactNode;

export interface VirtualListProps<Item> {
  height: number;
  width: number;
  getItemKey: GetItemKeyFn<Item>;
  approximateItemHeight: number;
  renderRow: RenderRowFn<Item>;
  reversed: boolean; // if the list is stick to the bottom
  items: Item[];
  selectedItem: Item;
  offscreenRatio: number;
  debug: boolean;
  onScroll?: (params: OnScrollEvent<Item>) => void; // fire on scroll only on meaningful scrolls
}

export interface VirtualListState<Item> {
  startIndexToRender: number;
  stopIndexToRender: number;
  items: Item[];
  estimatedTotalHeight: number;
}

export interface OnScrollEvent<Item> {
  items: Item[];
  calculatedMiddleIndexToRender: number;
}

export interface CorrectedItemMetadata {
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

export type ItemMetadata = {
  height: number;
  offset: number;
  measured: boolean;
};

export interface BuildOffsetsOptions<Item> {
  items: Item[];
  height: number;
  offset: number;
  lastPositionedIndex: number;
  anchorIndex: number | null;
  indexMustBeCalculated: number;
  offscreenRatio: number;
}

export interface GetInfoAboutNewItemsParams<Item extends Object> {
  prevItems: Item[];
  newItems: Item[];
  anchorItem: Item | null;
  lastPositionedIndex: number;
}

export interface EstimatedTotalHeightParams<Item extends Object> {
  lastPositionedItem: Item;
  lastPositionedIndex: number;
  itemsCount: number;
  approximateItemHeight: number;
}
