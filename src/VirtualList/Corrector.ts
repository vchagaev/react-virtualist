/**
 * This class is responsible for maintaining corrected offsets.
 * There is one important assumption here is that item indexes are stable during usage to properly.
 */
export class Corrector {
  indexToOffsetDeltaMap: Map<number, number>;
  indexToHeightDeltaMap: Map<number, number>;
  lastCorrectedIndex: number; // is closer to the 0
  firstCorrectedIndex: number; // is higher than lastCorrectedIndex. Since this index corrections start

  constructor() {
    this.indexToOffsetDeltaMap = new Map<number, number>();
    this.indexToHeightDeltaMap = new Map<number, number>();
    this.lastCorrectedIndex = 0;
    this.firstCorrectedIndex = 0;
  }
  init(index: number, initDelta: number) {
    if (this.indexToOffsetDeltaMap.size) {
      console.warn(
        "Initing Corrector that is already using . It will be cleared"
      );
    }

    this.indexToOffsetDeltaMap.clear();
    this.indexToHeightDeltaMap.clear();
    this.firstCorrectedIndex = index;
    this.lastCorrectedIndex = index;
    this.indexToOffsetDeltaMap.set(index, initDelta);
  }
  isInitialized() {
    return this.indexToOffsetDeltaMap.size > 0;
  }
  clear() {
    this.indexToOffsetDeltaMap.clear();
    this.indexToHeightDeltaMap.clear();
    this.lastCorrectedIndex = 0;
    this.firstCorrectedIndex = 0;
  }
  addNewHeightDelta(index: number, heightDelta: number) {
    if (index > this.firstCorrectedIndex) {
      console.warn(
        "addNewDelta index are higher than firstCorrectedIndex. It is just ignored",
        {
          index,
        }
      );
      return;
    }

    let realHeightDelta = heightDelta;
    let prevHeightDelta = this.indexToHeightDeltaMap.get(index);

    if (prevHeightDelta !== undefined) {
      realHeightDelta = heightDelta - prevHeightDelta;
    }

    this.indexToHeightDeltaMap.set(index, heightDelta);

    if (index < this.lastCorrectedIndex) {
      // just move corrected offset from lastCorrectedIndex
      let curCorrection = this.indexToOffsetDeltaMap.get(
        this.lastCorrectedIndex
      )!;

      for (let i = this.lastCorrectedIndex; i >= index; i--) {
        this.indexToOffsetDeltaMap.set(i, curCorrection);
      }

      this.indexToOffsetDeltaMap.set(index, curCorrection - realHeightDelta);
      this.lastCorrectedIndex = index;
    } else {
      // change corrected offsets for all items that are upper index
      for (let i = index; i >= this.lastCorrectedIndex; i--) {
        let curCorrection = this.indexToOffsetDeltaMap.get(i)!;

        this.indexToOffsetDeltaMap.set(i, curCorrection - realHeightDelta);
      }
    }
  }
  getOffsetDelta(index: number) {
    const offsetDelta = this.indexToOffsetDeltaMap.get(index);

    if (typeof offsetDelta === "number") {
      return offsetDelta;
    }

    // there is not corrections for such indexes
    if (index > this.firstCorrectedIndex) {
      return 0;
    }

    const lastOffsetDelta = this.indexToOffsetDeltaMap.get(
      this.lastCorrectedIndex
    );

    // indexes lower than lastCorrectedIndex have the same correction as lastCorrectedIndex
    return typeof lastOffsetDelta === "number" ? lastOffsetDelta : 0;
  }
  getHeightDelta(index: number) {
    const heightDelta = this.indexToHeightDeltaMap.get(index);

    if (typeof heightDelta === "number") {
      return heightDelta;
    }

    return null;
  }
}
