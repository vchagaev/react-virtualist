import React, { useCallback, useEffect, useState } from 'react'
import faker from "faker";
import "./App.css";
import "antd/dist/antd.css";

import {VariableSizeList} from 'react-window';
import { VirtualList } from "./VirtualList";
import { Message, MessageProps } from "./Message";

const getMessages = () => {
  return new Array(10)
    .fill(null)
    .map((_, index) => ({
      index,
      id: faker.random.uuid(),
      fullName: faker.name.findName(),
      avatarSrc: faker.internet.avatar(),
      content: faker.lorem.paragraphs(Math.ceil(Math.random() * 5)),
      date: faker.date.past(),
    }));
};

function App() {
  const getItemKey = useCallback(({ id }) => id, []);
  const [messages, setMessages] = useState(() => {
    return getMessages();
  });

  // useEffect(() => {
  //   setTimeout(() => {
  //     setMessages(messages.concat(getMessages()));
  //   }, 5 * 1000);
  // }, [setMessages, messages]);

  return (
    <div className="app">
      <div className="chat-container">
        <VirtualList<MessageProps>
          items={messages}
          getItemKey={getItemKey}
          width={500}
          height={600}
          renderRow={({ item: messageData, ref }) => (
            <div ref={ref}>
              <Message {...messageData} />
            </div>
          )}
        />
      </div>
    </div>
  );
}

export default App;
