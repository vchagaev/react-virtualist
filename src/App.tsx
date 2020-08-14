import React, { useCallback } from "react";
import faker from "faker";
import "./App.css";
import { VirtualList } from "./VirtualList";
import { Message, MessageProps } from "./Message";

function App() {
  const messages: MessageProps[] = new Array(100)
    .fill(null)
    .map((_, index) => ({
      index,
      id: faker.random.uuid(),
      fullName: faker.name.findName(),
      avatarSrc: faker.internet.avatar(),
      content: faker.lorem.paragraphs(Math.ceil(Math.random() * 5)),
      date: faker.date.past(),
    }));

  const getItemKey = useCallback(({ id }) => id, []);

  return (
    <div className="app">
      <div className="chat-container">
        <VirtualList<MessageProps>
          items={messages}
          getItemKey={getItemKey}
          width={400}
          height={800}
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
