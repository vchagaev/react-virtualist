export class Corrector {
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
             let curCorrection = this.indexToOffsetDeltaMap.get(
               this.lastCorrectedIndex
             )!;

             for (let i = this.lastCorrectedIndex; i >= index; i--) {
               this.indexToOffsetDeltaMap.set(i, curCorrection);
             }

             this.indexToOffsetDeltaMap.set(
               index,
               curCorrection - realHeightDelta
             );
             this.lastCorrectedIndex = index;
           } else {
             for (let i = index; i >= this.lastCorrectedIndex; i--) {
               let curCorrection = this.indexToOffsetDeltaMap.get(i)!;

               this.indexToOffsetDeltaMap.set(
                 i,
                 curCorrection - realHeightDelta
               );
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

           return null;
         }
         getLastCorrectedIndex() {
           return this.lastCorrectedIndex;
         }
       }
