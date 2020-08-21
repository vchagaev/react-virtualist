import React, { useCallback, useRef, useState } from "react";
import faker from "faker";
import AutoSizer from "react-virtualized-auto-sizer";
import { Button, Space, InputNumber, Typography, Divider } from "antd";
import "./App.css";
import "antd/dist/antd.css";

import { VirtualList } from "./VirtualList";
import { Message, MessageProps } from "./Message";

const { Text } = Typography;

const DEFAULT_BATCH_COUNT = 100;
const DEFAULT_MESSAGE_INDEX = 0;

const getMessages = (count = DEFAULT_BATCH_COUNT) => {
  return new Array(count).fill(null).map(() => ({
    id: faker.random.uuid(),
    fullName: faker.name.findName(),
    avatarSrc: faker.internet.avatar(),
    content: faker.lorem.paragraphs(Math.ceil(Math.random() * 2)),
    date: faker.date.past(),
  }));
};

function App() {
  const virtualListRef = useRef<VirtualList<MessageProps>>(null);
  const getItemKey = useCallback(({ id }) => id, []);
  const [messages, setMessages] = useState(() => {
    return getMessages();
  });
  const [messagesBatchCount, setMessagesBatchCount] = useState<number>(
    DEFAULT_BATCH_COUNT
  );
  const [messageIndex, setMessageIndex] = useState<number>(
    DEFAULT_MESSAGE_INDEX
  );
  const debugContainer = useRef<HTMLDivElement>(null);
  const renderRowCallback = useCallback(
    ({
      item: messageData,
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
    }) => {
      // XXX: for debug purposes only. Lead to a lot of rerenderings
      const offsetInfo = `${originalOffset} + ${offsetDelta} = ${correctedOffset}`;
      const heightInfo = `${originalHeight} + ${heightDelta} = ${correctedHeight}`;
      const fullName = `${index} ${messageData.fullName} (Offset: ${offsetInfo}) (Height: ${heightInfo})`;

      return (
        <div ref={ref}>
          <Message {...messageData} fullName={fullName} />
        </div>
      );
    },
    []
  );

  return (
    <div className="app">
      <div className="chat-container">
        <div className="chat-settings">
          <Space direction="vertical">
            <Text>Messages batch count</Text>
            <InputNumber
              style={{
                width: "100%",
              }}
              min={1}
              max={1000000}
              defaultValue={messagesBatchCount}
              onChange={(value) => {
                if (typeof value === "number") {
                  setMessagesBatchCount(value);
                }
              }}
            />
            <Button
              block={true}
              onClick={() => {
                const newMessages = [
                  ...getMessages(messagesBatchCount),
                  ...messages,
                ];
                setMessages(newMessages);
              }}
              type="primary"
            >
              Add older messages
            </Button>
            <Button
              block={true}
              onClick={() => {
                const newMessages = [
                  ...messages,
                  ...getMessages(messagesBatchCount),
                ];
                setMessages(newMessages);
              }}
              type="primary"
            >
              Add new messages
            </Button>
            <Divider />
            <Text>Message Index</Text>
            <InputNumber
              style={{
                width: "100%",
              }}
              min={0}
              max={messages.length - 1}
              defaultValue={DEFAULT_MESSAGE_INDEX}
              value={messageIndex}
              onChange={(value) => {
                if (typeof value === "number") {
                  setMessageIndex(value);
                }
              }}
            />
            <Button
              block={true}
              onClick={() => {
                if (virtualListRef.current) {
                  virtualListRef.current
                    .scrollTo({ index: messageIndex })
                    .then(() => {
                      console.log("scrolled");
                    })
                    .catch((error) => {
                      console.error(error);
                    });
                }
              }}
              type="primary"
            >
              Scroll to message index
            </Button>
            <Button
              block={true}
              onClick={() => {
                if (virtualListRef.current) {
                  virtualListRef.current
                    .scrollTo({
                      index: Math.round(Math.random() * messages.length),
                    })
                    .then(() => {
                      console.log("scrolled");
                    })
                    .catch((error) => {
                      console.error(error);
                    });
                }
              }}
              type="primary"
            >
              Scroll to random index
            </Button>
            <Divider />
            <div ref={debugContainer} />
          </Space>
        </div>
        <div className="chat-messages">
          <AutoSizer>
            {({ height, width }) => (
              <VirtualList<MessageProps>
                ref={virtualListRef}
                items={messages}
                getItemKey={getItemKey}
                width={width}
                height={height}
                renderRow={renderRowCallback}
                reversed={true}
                debugContainer={debugContainer.current}
                enabledDebugLayout={true}
                onScroll={(params) => {
                  console.log(params);
                }}
              />
            )}
          </AutoSizer>
        </div>
      </div>
    </div>
  );
}

export default App;
