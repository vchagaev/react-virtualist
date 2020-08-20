export class OffsetCorrector {
  indexToCorrectionMap: Map<number, number>;
  indexToCorrectedHeightMap: Map<number, number>;
  lastCorrectedIndex: number;
  firstCorrectedIndex: number;

  constructor() {
    this.indexToCorrectionMap = new Map<number, number>();
    this.indexToCorrectedHeightMap = new Map<number, number>();
    this.lastCorrectedIndex = 0;
    this.firstCorrectedIndex = 0;
  }
  init(index: number, correction: number) {
    console.log("OffsetCorrector: init", index);

    if (this.indexToCorrectionMap.size) {
      console.warn("initing already using OffsetCorrector. It will be cleared");
    }

    this.indexToCorrectionMap.clear();
    this.indexToCorrectedHeightMap.clear();
    this.firstCorrectedIndex = index;
    this.lastCorrectedIndex = index;
    this.indexToCorrectionMap.set(index, correction);
  }
  isInitialized() {
    return this.indexToCorrectionMap.size > 0;
  }
  clear() {
    console.log("OffsetCorrector: clear");
    this.indexToCorrectionMap.clear();
    this.indexToCorrectedHeightMap.clear();
    this.lastCorrectedIndex = 0;
    this.firstCorrectedIndex = 0;
  }
  addNewDelta(index: number, correction: number) {
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
        correction,
        valueBefore: this.indexToCorrectionMap.get(index)
      },
      "cost:",
      Math.abs(index - this.lastCorrectedIndex)
    );

    this.indexToCorrectedHeightMap.set(index, correction);

    if (index < this.lastCorrectedIndex) {
      let curCorrection = this.indexToCorrectionMap.get(
        this.lastCorrectedIndex
      )!;

      for (let i = this.lastCorrectedIndex; i >= index; i--) {
        this.indexToCorrectionMap.set(i, curCorrection);
      }

      this.indexToCorrectionMap.set(index, curCorrection - correction);
      this.lastCorrectedIndex = index;
    } else {
      for (let i = index; i >= this.lastCorrectedIndex; i--) {
        let curCorrection = this.indexToCorrectionMap.get(i)!;

        if (typeof curCorrection !== "number") {
          debugger; // impossible
        }

        this.indexToCorrectionMap.set(i, curCorrection - correction);
      }
    }
  }
  getCorrectedHeightsMap() {
    return this.indexToCorrectedHeightMap;
  }
  getCorrection(index: number) {
    const correction = this.indexToCorrectionMap.get(index);

    if (typeof correction === "number") {
      return correction;
    }

    if (index > this.firstCorrectedIndex) {
      return 0;
    }

    const lastCorrection = this.indexToCorrectionMap.get(this.lastCorrectedIndex);

    return typeof lastCorrection === 'number' ? lastCorrection : 0;
  }
  getCorrectedHeight(index: number) {
    const heightCorrection = this.indexToCorrectedHeightMap.get(index);

    if (typeof heightCorrection === 'number') {
      return heightCorrection;
    }

    return 0;
  }
  getLastCorrectedIndex() {
    return this.lastCorrectedIndex;
  }
}
