import React, { CSSProperties } from "react";
import { ItemMeasure, onResizeFn } from "./ItemMeasure";
import { CorrectedItemMetadata, RenderRowFn } from "./VirtualList";

interface RowProps<Item> {
  item: Item;
  onResize: onResizeFn;
  index: number;
  itemMetadata: CorrectedItemMetadata;
  anchorItem: Item | null;
  debug: boolean;
  renderRow: RenderRowFn<Item>;
}

export class Row<Item> extends React.PureComponent<RowProps<Item>, any> {
  render() {
    const {
      item,
      onResize,
      index,
      itemMetadata,
      anchorItem,
      debug,
      renderRow,
    } = this.props;

    return (
      <ItemMeasure onResize={onResize} index={index}>
        {({ measureRef }) => {
          const top = itemMetadata.correctedOffset;
          const curHeight = itemMetadata.correctedHeight;
          const style: CSSProperties = {
            position: "absolute",
            top,
            height: curHeight,
            opacity: itemMetadata.correctedMeasured ? 1 : 0,
            width: "100%",
          };

          if (debug) {
            style.backgroundColor =
              anchorItem === item
                ? "pink"
                : itemMetadata.offsetDelta
                ? "yellow"
                : "transparent";
            style.opacity = style.opacity === 0 ? 0.2 : 1;
          }

          return (
            <div style={style}>
              {renderRow({
                ref: measureRef,
                item,
                itemMetadata,
              })}
            </div>
          );
        }}
      </ItemMeasure>
    );
  }
}
