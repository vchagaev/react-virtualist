import React from "react";
import { Skeleton } from "antd";
import AutoSizer from "react-virtualized-auto-sizer";

import {
  OnScrollEvent,
  RenderRowProps,
  VirtualList,
} from "../VirtualList/VirtualList";
import { Message, MessageProps } from "./Message";

const DEBUG_MODE = false;

/**
 * ChatViewer is responsible for detecting the need for more items if they exist. Only for each direction at the time.
 * It also is responsible for adding ServiceItem (e.g. placeholders/indicators)
 */

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

  scrollTo = async (message: MessageProps) => {
    if (this.virtualListRef && this.virtualListRef.current) {
      return this.virtualListRef.current.scrollTo({
        ...message,
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
      let fullName = message.fullName;

      if (DEBUG_MODE) {
        const offsetInfo = `${originalOffset} + ${offsetDelta} = ${correctedOffset}`;
        const heightInfo = `${originalHeight} + ${heightDelta} = ${correctedHeight}`;
        fullName = `${index} ${message.fullName} (Offset: ${offsetInfo}) (Height: ${heightInfo})`;
      }

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

    if (hasOlder && !olderIsLoading && calculatedMiddleIndexToRender < 10) {
      this.setState({ olderIsLoading: true }, () => {
        onOlderMessageRequest(messages[0]).finally(() => {
          this.setState({
            olderIsLoading: false,
          });
        });
      });
    }

    if (
      hasNewer &&
      !newerIsLoading &&
      items.length - calculatedMiddleIndexToRender < 10
    ) {
      this.setState(
        {
          newerIsLoading: true,
        },
        () => {
          onNewerMessageRequest(messages[messages.length - 1]).finally(() => {
            this.setState({
              newerIsLoading: false,
            });
          });
        }
      );
    }
  };

  render() {
    const { hasOlder, messages, hasNewer, selectedMessage } = this.props;
    const { olderIsLoading, newerIsLoading } = this.state;
    const hasItems = messages.length > 0;

    if (!hasItems) {
      return;
    }

    const itemsForList: VirtualListItem[] = [];
    if (hasItems && (hasOlder || olderIsLoading)) {
      itemsForList.push({
        id: `older-placeholder#${messages[0].id}`, // unique id because we don't want to anchor them
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
        id: `newer-placeholder#${messages[messages.length - 1].id}`, // unique id because we don't want to anchor them
        typename: Typename.placeholder,
      });
    }
    let selectedMessageListItem = selectedMessage && {
      ...selectedMessage,
      typename: Typename.messgage,
    };

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
            selectedItem={selectedMessageListItem}
            reversed={true}
            debug={DEBUG_MODE}
            onScroll={this.onScroll}
          />
        )}
      </AutoSizer>
    );
  }
}
