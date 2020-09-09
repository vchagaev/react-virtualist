import { CorrectedItemMetadata, ItemMetadata } from './types'

interface StopIndexParams<Item extends Object> {
  items: Item[];
  startIndex: number;
  anchorIndex: number | null;
  offset: number;
  height: number;
  indexMustBeCalculated: number;
  offscreenRatio: number;
  getItemMetadata: (item: Item, index: number) => CorrectedItemMetadata
  setItemMetadata: (item: Item, newMeta: Partial<ItemMetadata>) => void
}

export function calculateStopIndexAndAnchor<Item>({
  items,
  startIndex,
  anchorIndex,
  offset,
  height,
  indexMustBeCalculated,
  offscreenRatio,
  getItemMetadata,
  setItemMetadata,
}: StopIndexParams<Item>) {
  let newAnchorItem = null;
  let newAnchorIndex = null;
  const startItem = items[startIndex];
  const itemMetadata = getItemMetadata(startItem, startIndex);
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
    setItemMetadata(curItem, {
      offset: curOffset,
    });
    const curItemMetadata = getItemMetadata(curItem, stopIndex);

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
    setItemMetadata(curItem, {
      offset: curOffset,
    });
    const curItemMetadata = getItemMetadata(curItem, stopIndex);
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
      setItemMetadata(curItem, {
        offset: curOffset,
      });
      const curItemMetadata = getItemMetadata(curItem, stopIndex);
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
}
