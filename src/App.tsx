import React, { useCallback, useEffect, useRef, useState } from "react";
import faker from "faker";
import AutoSizer from "react-virtualized-auto-sizer";
import "./App.css";
import "antd/dist/antd.css";

import { VirtualList } from "./VirtualList";
import { Message, MessageProps } from "./Message";

const getMessages = () => {
  return new Array(10).fill(null).map((_, index) => ({
    index,
    id: faker.random.uuid(),
    fullName: faker.name.findName(),
    avatarSrc: faker.internet.avatar(),
    content: faker.lorem.paragraphs(Math.ceil(Math.random() * 5)),
    date: faker.date.past(),
  }));
};

function App() {
  const virtualListRef = useRef<VirtualList<MessageProps>>(null);
  const getItemKey = useCallback(({ id }) => id, []);
  const [messages, setMessages] = useState(() => {
    return getMessages();
  });

  useEffect(() => {
    setTimeout(() => {
      const newMessages = [...messages, ...getMessages()];
      setMessages(newMessages);
    }, 10 * 1000);
  }, [setMessages, messages]);

  useEffect(() => {
    if (virtualListRef.current) {
      virtualListRef.current.scrollToIndex(messages.length - 1);
    }
  }, [virtualListRef, messages]);

  return (
    <div className="app">
      <div className="chat-container">
        <AutoSizer>
          {({ height, width }) => (
            <VirtualList<MessageProps>
              ref={virtualListRef}
              items={messages}
              getItemKey={getItemKey}
              width={width}
              height={height}
              renderRow={({ item: messageData, ref }) => (
                <div ref={ref}>
                  <Message {...messageData} />
                </div>
              )}
            />
          )}
        </AutoSizer>
      </div>
    </div>
  );
}

export default App;
