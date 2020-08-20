export class OffsetCorrector {
  indexToOffsetDeltaMap: Map<number, number>;
  indexToHeightDeltaMap: Map<number, number>;
  lastCorrectedIndex: number;
  firstCorrectedIndex: number;

  constructor() {
    this.indexToOffsetDeltaMap = new Map<number, number>();
    this.indexToHeightDeltaMap = new Map<number, number>();
    this.lastCorrectedIndex = 0;
    this.firstCorrectedIndex = 0;
  }
  log() {
    if (this.isInitialized()) {
      const offsets = Array.from(this.indexToOffsetDeltaMap.entries())
        .map(([index, value]) => `${index} -> ${value}`)
        .join(",\n");
      const heights = Array.from(this.indexToHeightDeltaMap.entries())
        .map(([index, value]) => `${index} -> ${value}`)
        .join(",\n");

      console.log('curroffsets: \n', offsets);
      console.log('currheights: \n', heights);
    }
  }
  init(index: number, initDelta: number) {
    console.log("OffsetCorrector: init", index);

    if (this.indexToOffsetDeltaMap.size) {
      console.warn("initing already using OffsetCorrector. It will be cleared");
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
    console.log("OffsetCorrector: clear");
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

    console.log(
      "OffsetCorrector: new delta",
      {
        index,
        correction: heightDelta,
        valueBefore: this.indexToOffsetDeltaMap.get(index),
      },
      "cost:",
      Math.abs(index - this.lastCorrectedIndex)
    );

    let realHeightDelta = heightDelta;
    let prevHeightDelta = this.indexToHeightDeltaMap.get(index);

    if (prevHeightDelta !== undefined) {
      realHeightDelta = heightDelta - prevHeightDelta;
    }

    this.indexToHeightDeltaMap.set(index, heightDelta);


    if (index < this.lastCorrectedIndex) {
      let curCorrection = this.indexToOffsetDeltaMap.get(
        this.lastCorrectedIndex
      )!;

      for (let i = this.lastCorrectedIndex; i >= index; i--) {
        this.indexToOffsetDeltaMap.set(i, curCorrection);
      }

      this.indexToOffsetDeltaMap.set(index, curCorrection - realHeightDelta);
      this.lastCorrectedIndex = index;
    } else {
      for (let i = index; i >= this.lastCorrectedIndex; i--) {
        let curCorrection = this.indexToOffsetDeltaMap.get(i)!;

        this.indexToOffsetDeltaMap.set(i, curCorrection - realHeightDelta);
      }
    }
  }
  getHeightDeltaMap() {
    return this.indexToHeightDeltaMap;
  }
  getOffsetDelta(index: number) {
    const offsetDelta = this.indexToOffsetDeltaMap.get(index);

    if (typeof offsetDelta === "number") {
      return offsetDelta;
    }

    if (index > this.firstCorrectedIndex) {
      return 0;
    }

    const lastOffsetDelta = this.indexToOffsetDeltaMap.get(
      this.lastCorrectedIndex
    );

    return typeof lastOffsetDelta === "number" ? lastOffsetDelta : 0;
  }
  getHeightDelta(index: number) {
    const heightDelta = this.indexToHeightDeltaMap.get(index);

    if (typeof heightDelta === "number") {
      return heightDelta;
    }

    return 0;
  }
  getLastCorrectedIndex() {
    return this.lastCorrectedIndex;
  }
}
