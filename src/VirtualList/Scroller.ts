import { wait } from "../utils";
import { CorrectedItemMetadata, GetItemKeyFn } from './types'

interface ScrollToItemParams<Item> {
  item: Item;
  items: Item[];
  container: HTMLDivElement | null;
  retries?: number;
}

const DEFAULT_RETRIES_COUNT = 5;

export class Scroller<Item> {
  scrollingToItem: Item | null = null;
  scrollingToIndex: number | null = null;

  constructor(
    private getItemKey: GetItemKeyFn<Item>,
    private waitForSyncMs: number,
    private getCorrectedItemMetadata: (
      item: Item,
      index: number
    ) => CorrectedItemMetadata,
    private update: () => Promise<void>,
    private getMaximumPossibleOffset: () => number
  ) {}

  getIndexByItem = (propsItems: Item[], item: Item) => {
    const index = propsItems.findIndex(
      (i) => this.getItemKey(i) === this.getItemKey(item)
    );
    if (index === -1) {
      return null;
    }
    return index;
  };

  async scrollToItem(params: ScrollToItemParams<Item>): Promise<number> {
    const {
      item,
      items,
      container,
      retries = DEFAULT_RETRIES_COUNT,
    } = params;
    if (
      this.scrollingToItem !== null &&
      this.getItemKey(this.scrollingToItem) !== this.getItemKey(item)
    ) {
      console.warn(
        `Already scrolling to item: ${this.scrollingToItem}, but got item: ${item}. It is ignored`
      );
    }

    let index =
      this.scrollingToIndex === null
        ? this.getIndexByItem(items, item)
        : this.scrollingToIndex;

    if (index === null) {
      this.scrollingToItem = null;
      this.scrollingToIndex = null;
      throw new Error(`There is no such item in the list, ${item}`);
    }

    if (!container) {
      this.scrollingToItem = null;
      this.scrollingToIndex = null;
      throw new Error("Container is not initialized yet");
    }

    this.scrollingToItem = item;
    this.scrollingToIndex = index;

    await this.update(); // wait for building new metadata by buildItemsMetadata

    const {
      correctedOffset,
      correctedMeasured,
    } = this.getCorrectedItemMetadata(items[index], index);
    const newOffset = Math.min(
      this.getMaximumPossibleOffset(),
      correctedOffset
    );

    if (correctedMeasured && container.scrollTop === newOffset) {
      this.scrollingToItem = null;
      this.scrollingToIndex = null;
      return container.scrollTop;
    } else if (retries <= 0) {
      this.scrollingToItem = null;
      this.scrollingToIndex = null;
      throw new Error(`Could not scroll to index ${index}. No retries left`);
    }

    container.scrollTop = newOffset;

    await wait(this.waitForSyncMs); // wait for state.offset to be changed by scroll

    return this.scrollToItem({ ...params, retries: retries - 1 });
  }
}
