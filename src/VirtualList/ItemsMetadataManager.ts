import { CorrectedItemMetadata, GetItemKeyFn, ItemMetadata } from "./types";
import { Corrector } from "./Corrector";

export class ItemsMetadataManager<Item> {
  corrector: Corrector = new Corrector();
  itemKeyToMetadata: Map<string, ItemMetadata> = new Map<
    string,
    ItemMetadata
  >();

  ensureItemMetadata = (itemKey: string) => {
    if (!this.itemKeyToMetadata.has(itemKey)) {
      const meta = {
        height: this.approximateItemHeight,
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
    const key = this.getItemKey(item);
    this.ensureItemMetadata(key);

    const meta = this.itemKeyToMetadata.get(key)!;

    this.itemKeyToMetadata.set(key, { ...meta, ...newMeta });
  };

  getItemMetadata = (item: Item) => {
    const key = this.getItemKey(item);
    this.ensureItemMetadata(key);

    return this.itemKeyToMetadata.get(key)!;
  };

  getCorrectedItemMetadata = (
    item: Item,
    index: number
  ): CorrectedItemMetadata => {
    const key = this.getItemKey(item);
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

  constructor(
    private getItemKey: GetItemKeyFn<Item>,
    private approximateItemHeight: number
  ) {}
}
