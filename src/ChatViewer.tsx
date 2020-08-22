import React from "react";
import { OnScrollEvent, RenderRowProps, VirtualList } from "./VirtualList";
import { Message, MessageProps } from "./Message";
import AutoSizer from "react-virtualized-auto-sizer";
import { Skeleton } from "antd";

interface ChatViewerProps {
  id: string;
  hasOlder: boolean;
  selectedMessage?: MessageProps;
  hasNewer: boolean;
  messages: MessageProps[];
  onNewerMessageRequest: (message: MessageProps) => Promise<void>;
  onOlderMessageRequest: (message: MessageProps) => Promise<void>;
}
interface ChatViewerState {
  olderIsLoading: boolean;
  newerIsLoading: boolean;
}

enum Typename {
  messgage,
  placeholder,
}
interface ServiceItem {
  id: string;
  typename: Typename;
}
interface MessageData extends MessageProps {
  typename: Typename;
}

type VirtualListItem = MessageData | ServiceItem;

export class ChatViewer extends React.PureComponent<
  ChatViewerProps,
  ChatViewerState
> {
  virtualListRef: React.RefObject<
    VirtualList<VirtualListItem>
  > = React.createRef<VirtualList<VirtualListItem>>();

  state = {
    olderIsLoading: false,
    newerIsLoading: false,
  };

  scrollTo = async (index: number) => {
    const { messages } = this.props;

    if (this.virtualListRef && this.virtualListRef.current) {
      return this.virtualListRef.current.scrollTo({
        ...messages[index],
        typename: Typename.messgage,
      });
    }
  };

  getItemKey = (item: VirtualListItem) => {
    return item.id;
  };

  renderItem = ({
    item,
    ref,
    itemMetadata: {
      index,
      originalHeight,
      originalOffset,
      offsetDelta,
      heightDelta,
      correctedOffset,
      correctedHeight,
    },
  }: RenderRowProps<VirtualListItem>) => {
    if (item.typename === Typename.messgage) {
      const message = item as MessageData;
      // XXX: for debug purposes only. Lead to a lot of rerenderings
      const offsetInfo = `${originalOffset} + ${offsetDelta} = ${correctedOffset}`;
      const heightInfo = `${originalHeight} + ${heightDelta} = ${correctedHeight}`;
      const fullName = `${index} ${message.fullName} (Offset: ${offsetInfo}) (Height: ${heightInfo})`;

      return (
        <div ref={ref}>
          <Message {...message} fullName={fullName} />
        </div>
      );
    }
    if (item.typename === Typename.placeholder) {
      return (
        <div ref={ref}>
          <Skeleton active avatar paragraph={{ rows: 1 }} />
        </div>
      );
    }
  };

  onScroll = ({
    items,
    calculatedMiddleIndexToRender,
  }: OnScrollEvent<VirtualListItem>) => {
    const {
      messages,
      onNewerMessageRequest,
      onOlderMessageRequest,
      hasOlder,
      hasNewer,
    } = this.props;
    const { newerIsLoading, olderIsLoading } = this.state;

    console.log('calculatedMiddleIndexToRender', calculatedMiddleIndexToRender);

    if (hasOlder && !olderIsLoading) {
      if (calculatedMiddleIndexToRender < 10) {
        this.setState({ olderIsLoading: true });
        onOlderMessageRequest(messages[0]).finally(() => {
          this.setState({
            olderIsLoading: false,
          });
        });
        return;
      }
    }

    if (hasNewer && !newerIsLoading) {
      if (items.length - calculatedMiddleIndexToRender < 10) {
        this.setState({
          newerIsLoading: true,
        });
        onNewerMessageRequest(messages[messages.length - 1]).finally(() => {
          this.setState({
            newerIsLoading: false,
          });
        });
      }
    }
  };

  render() {
    const { hasOlder, messages, hasNewer } = this.props;
    const { olderIsLoading, newerIsLoading } = this.state;
    const hasItems = messages.length > 0;

    const itemsForList: VirtualListItem[] = [];
    if (hasItems && (hasOlder || olderIsLoading)) {
      itemsForList.push({
        id: `older-placeholder#${messages[0].id}`,
        typename: Typename.placeholder,
      });
    }
    itemsForList.push(
      ...messages.map((message) => ({
        ...message,
        typename: Typename.messgage,
      }))
    );
    if (hasItems && (hasNewer || newerIsLoading)) {
      itemsForList.push({
        id: `newer-placeholder#${messages[messages.length - 1].id}`,
        typename: Typename.placeholder,
      });
    }

    return (
      <AutoSizer>
        {({ height, width }) => (
          <VirtualList<VirtualListItem>
            ref={this.virtualListRef}
            items={itemsForList}
            getItemKey={this.getItemKey}
            width={width}
            height={height}
            renderRow={this.renderItem}
            reversed={true}
            enabledDebugLayout={true}
            onScroll={this.onScroll}
          />
        )}
      </AutoSizer>
    );
  }
}
