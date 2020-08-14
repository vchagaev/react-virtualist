import React from "react";

interface VirtualListProps<Item> {
  items: Item[];
  height: number;
  width: number;
  getItemKey: (item: Item) => string;
  estimatedItemSize?: number;
  renderRow: (renderRowProps: RenderRowProps<Item>) => React.ReactNode;
}

interface VirtualListState {
  scrollTop: number;
}

interface RenderRowProps<Item> {
  index: number;
  item: Item;
  ref: React.Ref<HTMLDivElement>; // TODO: any dom node
}

export class VirtualList<Item> extends React.Component<
  VirtualListProps<Item>,
  VirtualListState
> {
  render() {
    const {
      items
    } = this.props;

    return items.length;
  }
}
