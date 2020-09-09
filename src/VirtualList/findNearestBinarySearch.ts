import { CorrectedItemMetadata } from './types'

export function findNearestItemBinarySearch<Item>(
  items: Item[],
  offset: number,
  lastPositionedIndex: number,
  getMetadata: (item: Item, index: number) => CorrectedItemMetadata
) {
  let low = 0;
  let high = lastPositionedIndex;

  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const currentOffset = getMetadata(items[middle], middle).correctedOffset;

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
}
